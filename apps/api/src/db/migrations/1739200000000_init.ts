import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createExtension("pgcrypto", { ifNotExists: true });

  // --- users: identity is the wallet address, nothing more required to sign in ---
  pgm.createTable("users", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    wallet_address: { type: "text", notNull: true, unique: true },
    display_name: { type: "text" },
    bio: { type: "text" },
    avatar_url: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // --- bounties: off-chain mirror of the on-chain bounty, keyed by the contract's bounty_id ---
  pgm.createTable("bounties", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    chain_bounty_id: { type: "text", unique: true }, // set once the create_bounty tx confirms
    creator_id: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    title: { type: "text", notNull: true },
    description: { type: "text", notNull: true },
    incident_type: { type: "text", notNull: true },
    incident_occurred_at: { type: "timestamptz" },
    location_context: { type: "text" },
    evidence_requirements: { type: "text" },
    witness_bond_wei: { type: "numeric(78,0)", notNull: true, default: "0" },
    reward_wei: { type: "numeric(78,0)", notNull: true, default: "0" },
    reward_deposited_wei: { type: "numeric(78,0)", notNull: true, default: "0" },
    visibility: { type: "text", notNull: true, default: "public" }, // public | unlisted
    status: {
      type: "text",
      notNull: true,
      default: "draft",
      check: "status in ('draft','pending_escrow','open','evaluating','resolved','cancelled','timed_out')",
    },
    submission_deadline: { type: "timestamptz" },
    create_tx_hash: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("bounties", "status");
  pgm.createIndex("bounties", "creator_id");

  // --- testimonies: submitter's account + evidence references (contract only stores hashes/urls) ---
  pgm.createTable("testimonies", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    chain_testimony_id: { type: "text" },
    bounty_id: { type: "uuid", notNull: true, references: "bounties", onDelete: "CASCADE" },
    submitter_id: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    statement: { type: "text", notNull: true },
    statement_hash: { type: "text", notNull: true }, // sha256 of statement, anchored on-chain
    occurred_at: { type: "timestamptz" },
    location_context: { type: "text" },
    is_anonymous: { type: "boolean", notNull: true, default: false },
    bond_wei: { type: "numeric(78,0)", notNull: true, default: "0" },
    bond_deposited_wei: { type: "numeric(78,0)", notNull: true, default: "0" },
    status: {
      type: "text",
      notNull: true,
      default: "submitted",
      check: "status in ('submitted','under_review','corroborated','disputed','rejected')",
    },
    submit_tx_hash: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("testimonies", "bounty_id");
  pgm.createIndex("testimonies", "submitter_id");

  // --- evidence_files: uploaded media/doc metadata, one row per file, URL passed to the contract ---
  pgm.createTable("evidence_files", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    testimony_id: { type: "uuid", notNull: true, references: "testimonies", onDelete: "CASCADE" },
    kind: { type: "text", notNull: true, check: "kind in ('image','document','video','url')" },
    url: { type: "text", notNull: true },
    file_hash: { type: "text" },
    mime_type: { type: "text" },
    size_bytes: { type: "bigint" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("evidence_files", "testimony_id");

  // --- evaluations: tracks the on-chain evaluate_bounty/settle transaction lifecycle ---
  pgm.createTable("evaluations", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    bounty_id: { type: "uuid", notNull: true, references: "bounties", onDelete: "CASCADE" },
    status: {
      type: "text",
      notNull: true,
      default: "idle",
      check:
        "status in ('idle','preparing','submitted','pending','confirmed','failed','timeout','needs_human_review')",
    },
    verdict: { type: "text", check: "verdict in ('passed','failed','partial_pass','needs_human_review')" },
    confidence_bps: { type: "integer" },
    payout_bps: { type: "integer" },
    rationale: { type: "text" },
    corroboration_json: { type: "jsonb" },
    evaluate_tx_hash: { type: "text" },
    settle_tx_hash: { type: "text" },
    error_message: { type: "text" },
    requested_at: { type: "timestamptz" },
    confirmed_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("evaluations", "bounty_id");

  // --- truth_records: the final public, immutable record (mirrors on-chain state for fast reads) ---
  pgm.createTable("truth_records", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    bounty_id: { type: "uuid", notNull: true, references: "bounties", onDelete: "CASCADE", unique: true },
    evaluation_id: { type: "uuid", notNull: true, references: "evaluations", onDelete: "RESTRICT" },
    contract_address: { type: "text", notNull: true },
    final_state_root: { type: "text" },
    published_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // --- reputation_events: append-only ledger; current score is derived, never mutated in place ---
  pgm.createTable("reputation_events", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    bounty_id: { type: "uuid", references: "bounties", onDelete: "SET NULL" },
    event_type: {
      type: "text",
      notNull: true,
      check:
        "event_type in ('testimony_corroborated','testimony_disputed','testimony_rejected','false_report_penalty','account_age_bonus')",
    },
    delta_bps: { type: "integer", notNull: true },
    note: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("reputation_events", "user_id");

  // --- notifications ---
  pgm.createTable("notifications", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    kind: { type: "text", notNull: true },
    payload: { type: "jsonb", notNull: true, default: "{}" },
    read_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("notifications", ["user_id", "read_at"]);

  // --- tx_status_log: generic on-chain transaction lifecycle tracker, referenced by feature tables ---
  pgm.createTable("tx_status_log", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
    subject_type: { type: "text", notNull: true }, // 'bounty' | 'testimony' | 'evaluation'
    subject_id: { type: "uuid", notNull: true },
    action: { type: "text", notNull: true }, // 'create_bounty' | 'submit_testimony' | 'settle' | ...
    tx_hash: { type: "text" },
    status: {
      type: "text",
      notNull: true,
      check:
        "status in ('idle','preparing','wallet_check','requested','submitted','pending','confirmed','rejected','failed','timeout','backend_sync_failed')",
    },
    error_message: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("tx_status_log", ["subject_type", "subject_id"]);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("tx_status_log");
  pgm.dropTable("notifications");
  pgm.dropTable("reputation_events");
  pgm.dropTable("truth_records");
  pgm.dropTable("evaluations");
  pgm.dropTable("evidence_files");
  pgm.dropTable("testimonies");
  pgm.dropTable("bounties");
  pgm.dropTable("users");
}

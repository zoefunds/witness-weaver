import { cookieStorage, createStorage } from "wagmi";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { genlayerStudionet } from "./chains";

// Reown (WalletConnect) project ID — public identifier, safe on the client.
export const reownProjectId =
  process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "ac2916416ff33818b08570fc1132c285";

export const networks = [genlayerStudionet] as const;

export const wagmiAdapter = new WagmiAdapter({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wagmi/appkit ship slightly divergent Storage generics across versions; runtime shape is identical
  storage: createStorage({ storage: cookieStorage }) as any,
  ssr: true,
  projectId: reownProjectId,
  networks: [...networks],
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

import { Provider } from "@project-serum/anchor";

export async function checkLamports(
  provider: Provider,
  min: number,
  log: any
): Promise<void> {
  const lamports = (
    await provider.connection.getAccountInfo(provider.wallet.publicKey)
  ).lamports;

  if (lamports < min) {
    log.fatal({ err: "Insufficient lamports" });
    throw new Error("Insufficient lamports");
  }
}

export function getTime(): [number, number] {
  const now = new Date();
  return [now.getMinutes(), now.getSeconds()];
}

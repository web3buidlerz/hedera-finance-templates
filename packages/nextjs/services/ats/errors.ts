// Server-only: decodes a viem revert into the ATS custom error's name, e.g. "AccountIsBlocked",
// so the activity log can show the refusal decoded rather than a raw revert selector.
import { BaseError, ContractFunctionRevertedError } from "viem";

export type DecodedAtsError = { name: string; message: string };

export function decodeAtsError(error: unknown): DecodedAtsError {
  if (error instanceof BaseError) {
    const revertError = error.walk(e => e instanceof ContractFunctionRevertedError);
    if (revertError instanceof ContractFunctionRevertedError) {
      const errorName = revertError.data?.errorName ?? revertError.reason ?? revertError.signature ?? "Reverted";
      const args = revertError.data?.args ?? [];
      const message = args.length ? `${errorName}(${args.join(", ")})` : errorName;
      return { name: errorName, message };
    }
    return { name: "Error", message: error.shortMessage ?? error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { name: "Error", message };
}

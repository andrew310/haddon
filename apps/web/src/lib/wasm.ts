type WasmModule = typeof import("../../../../packages/wasm/pkg/haddon_wasm");
type PublicationSession = InstanceType<WasmModule["PublicationSession"]>;

const wasmCache = globalThis as typeof globalThis & {
  __haddonWasm?: WasmModule;
  __haddonWasmLoading?: Promise<WasmModule>;
};

export async function getWasm(): Promise<WasmModule> {
  if (wasmCache.__haddonWasm) return wasmCache.__haddonWasm;
  if (!wasmCache.__haddonWasmLoading) {
    wasmCache.__haddonWasmLoading = (async () => {
      const mod = await import("../../../../packages/wasm/pkg/haddon_wasm");
      await mod.default();
      wasmCache.__haddonWasm = mod;
      return mod;
    })();
  }
  return wasmCache.__haddonWasmLoading;
}

export function disposePublicationSession(
  session: PublicationSession | null | undefined,
): void {
  if (!session) return;
  try {
    session.free();
  } catch {
    // wasm-bindgen panics on a second free or a use-after-free; never throw from cleanup.
  }
}

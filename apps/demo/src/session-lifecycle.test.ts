import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type WasmModule = typeof import("../../../packages/wasm/pkg/haddon_wasm");

function disposeSession(session: { free: () => void } | null) {
  if (!session) return;
  try {
    session.free();
  } catch {
    // ignore double-free
  }
}

describe("PublicationSession lifecycle", () => {
  let wasm: WasmModule;

  beforeAll(async () => {
    wasm = await import("../../../packages/wasm/pkg/haddon_wasm.js");
    const wasmBytes = readFileSync(
      join(__dirname, "../../../packages/wasm/pkg/haddon_wasm_bg.wasm"),
    );
    await wasm.default(wasmBytes);
  });

  it("can dispose a session and open another on the same module", () => {
    const first = wasm.PublicationSession.load_citation_fixture();
    expect(first.reading_order_json()).toContain("chapter-1");
    disposeSession(first);

    const second = wasm.PublicationSession.load_citation_fixture();
    expect(JSON.parse(second.toc_json()).length).toBeGreaterThan(0);
    expect(second.first_linear_href()).toBe("text/chapter-1.xhtml");
    disposeSession(second);
  });

  it("does not throw if dispose is called twice", () => {
    const session = wasm.PublicationSession.load_citation_fixture();
    expect(() => {
      disposeSession(session);
      disposeSession(session);
    }).not.toThrow();
  });
});

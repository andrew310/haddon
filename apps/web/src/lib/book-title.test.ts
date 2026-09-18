import { describe, expect, it } from "vitest";
import { displayBookTitle } from "./book-title";

describe("displayBookTitle", () => {
  it("keeps a short title", () => {
    expect(displayBookTitle("The Brass Observatory")).toBe("The Brass Observatory");
  });

  it("strips archive metadata from a dump title", () => {
    expect(
      displayBookTitle(
        "God of Promise _ Introducing Covenant Theology -- Horton, Michael Scott -- 2006;2009 -- Baker Publishing Group -- 9780801071959 -- 9e1f632fec5d16f5b0665bacaace9d9f -- Anna’s Archive",
      ),
    ).toBe("God of Promise: Introducing Covenant Theology");
  });
});

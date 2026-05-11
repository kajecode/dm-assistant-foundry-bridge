/**
 * Tests for the error-explainer that turns an ApiError into a
 * UI-renderable hint. The hint is the value-add over a bare
 * "Failed to fetch" — these tests pin the hint content so future
 * UX tweaks don't accidentally regress the CORS guidance.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { ApiError } from "../src/api/client.js";
import { explainError } from "../src/lib/errorHints.js";

describe("explainError", () => {
  beforeEach(() => {
    // happy-dom's default location.origin is "https://localhost:8080";
    // pin a stable origin so the hint string is deterministic.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        origin: "https://fvtt-local.kaje.org",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("network errors mention the current origin so the operator can copy-paste it", () => {
    const err = new ApiError("Failed to fetch", { kind: "network", url: "https://api/foundry/health" });
    const hint = explainError(err);
    expect(hint.message).toContain("https://fvtt-local.kaje.org");
    expect(hint.detail).toContain("ALLOWED_ORIGINS");
    expect(hint.origin).toBe("https://fvtt-local.kaje.org");
  });

  it("network hints call out CORS as the most likely cause", () => {
    const err = new ApiError("Failed to fetch", { kind: "network" });
    const hint = explainError(err);
    // The "1. CORS" line is the actionable one for the dominant case
    // (URL works in curl/Insomnia, fails in browser). Pin it.
    expect(hint.detail).toContain("CORS");
    expect(hint.detail).toContain("Insomnia");
  });

  it("network hints also flag mixed-content as a possibility", () => {
    const err = new ApiError("Failed to fetch", { kind: "network" });
    const hint = explainError(err);
    expect(hint.detail).toContain("Mixed content");
  });

  it("HTTP 404 hint suggests the URL is wrong", () => {
    const err = new ApiError("HTTP 404", { kind: "http", status: 404, url: "https://api/foundry/health" });
    const hint = explainError(err);
    expect(hint.message).toContain("404");
    expect(hint.detail).toContain("base URL");
    expect(hint.detail).toContain("/api");
  });

  it("HTTP 403 hint mentions the DM-role check", () => {
    const err = new ApiError("HTTP 403", { kind: "http", status: 403, url: "u" });
    const hint = explainError(err);
    expect(hint.detail).toContain("DM-only");
  });

  it("HTTP 401 hint mentions the API key setting", () => {
    const err = new ApiError("HTTP 401", { kind: "http", status: 401, url: "u" });
    const hint = explainError(err);
    expect(hint.detail).toContain("API key");
  });

  it("HTTP 500 falls through to the generic server-error message", () => {
    const err = new ApiError("HTTP 500", { kind: "http", status: 500, url: "u" });
    const hint = explainError(err);
    expect(hint.detail).toContain("error response");
  });

  it("timeout hint mentions the 5-second budget + journalctl", () => {
    const err = new ApiError("Timeout after 5000ms", { kind: "timeout" });
    const hint = explainError(err);
    expect(hint.detail).toContain("5 seconds");
    expect(hint.detail).toContain("journalctl");
  });

  it("shape hint suggests the base URL points at the wrong service", () => {
    const err = new ApiError("Response missing api_contract_version", { kind: "shape" });
    const hint = explainError(err);
    expect(hint.message).toContain("wrong service");
    expect(hint.detail).toContain("api_contract_version");
  });

  it("config hint passes through the underlying message verbatim", () => {
    const err = new ApiError("baseUrl is empty", { kind: "config" });
    const hint = explainError(err);
    expect(hint.message).toBe("baseUrl is empty");
    expect(hint.detail).toBe("baseUrl is empty");
  });
});

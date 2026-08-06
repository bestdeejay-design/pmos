import { describe, it, expect } from "vitest";
import { inDndWindow, dailyAllowed, parseDailyLimit, todayStartUtcIso } from "../src/lib/policy.js";

describe("inDndWindow", () => {
  it("returns false when no window configured (fail-open)", () => {
    expect(inDndWindow(3, undefined)).toBe(false);
    expect(inDndWindow(3, "")).toBe(false);
  });

  it("returns false for malformed window strings (fail-open)", () => {
    expect(inDndWindow(3, "banana")).toBe(false);
    expect(inDndWindow(3, "22-8-9")).toBe(false);
    expect(inDndWindow(3, "25-8")).toBe(false);
  });

  it("returns false when start === end (no restriction)", () => {
    expect(inDndWindow(7, "7-7")).toBe(false);
  });

  it("handles a simple non-wrapping window", () => {
    expect(inDndWindow(9, "8-18")).toBe(true);
    expect(inDndWindow(18, "8-18")).toBe(false);
    expect(inDndWindow(7, "8-18")).toBe(false);
  });

  it("handles a midnight-wrapping window (22-8)", () => {
    expect(inDndWindow(22, "22-8")).toBe(true);
    expect(inDndWindow(23, "22-8")).toBe(true);
    expect(inDndWindow(0, "22-8")).toBe(true);
    expect(inDndWindow(7, "22-8")).toBe(true);
    expect(inDndWindow(8, "22-8")).toBe(false);
    expect(inDndWindow(21, "22-8")).toBe(false);
  });
});

describe("dailyAllowed", () => {
  it("always allows when no limit (fail-open)", () => {
    expect(dailyAllowed(0, undefined)).toBe(true);
    expect(dailyAllowed(999, undefined)).toBe(true);
    expect(dailyAllowed(0, 0)).toBe(true);
    expect(dailyAllowed(5, -1)).toBe(true);
  });

  it("allows below the cap and rejects at/above it", () => {
    expect(dailyAllowed(0, 3)).toBe(true);
    expect(dailyAllowed(2, 3)).toBe(true);
    expect(dailyAllowed(3, 3)).toBe(false);
    expect(dailyAllowed(4, 3)).toBe(false);
  });
});

describe("parseDailyLimit", () => {
  it("returns undefined when unset or empty (fail-open)", () => {
    expect(parseDailyLimit(undefined)).toBeUndefined();
    expect(parseDailyLimit("")).toBeUndefined();
  });

  it("returns a positive integer for valid input", () => {
    expect(parseDailyLimit("5")).toBe(5);
    expect(parseDailyLimit("0")).toBeUndefined();
    expect(parseDailyLimit("-3")).toBeUndefined();
    expect(parseDailyLimit("abc")).toBeUndefined();
    expect(parseDailyLimit("2.5")).toBeUndefined();
  });
});

describe("todayStartUtcIso", () => {
  it("returns UTC midnight for a fixed instant", () => {
    const noon = new Date("2026-08-06T12:34:56.789Z");
    expect(todayStartUtcIso(noon)).toBe("2026-08-06T00:00:00.000Z");
  });

  it("uses the current date when no argument is given", () => {
    const now = new Date();
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    expect(todayStartUtcIso()).toBe(today.toISOString());
  });
});
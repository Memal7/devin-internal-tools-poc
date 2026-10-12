import { describe, expect, it } from "vitest";
import { formatMinor, parseAmountToMinor } from "@/platform/money";
import { buildTableHref, parseTableParams } from "@/platform/ui/table-params";

describe("money helpers", () => {
  it("parses decimal strings into integer minor units without floats", () => {
    expect(parseAmountToMinor("1500", "EUR")).toBe(150_000);
    expect(parseAmountToMinor("1500.5", "EUR")).toBe(150_050);
    expect(parseAmountToMinor("0.29", "EUR")).toBe(29);
    expect(parseAmountToMinor("1.234", "EUR")).toBeNull();
    expect(parseAmountToMinor("-1", "EUR")).toBeNull();
    expect(parseAmountToMinor("abc", "EUR")).toBeNull();
  });

  it("formats minor units", () => {
    expect(formatMinor(123_456_789, "EUR")).toBe("1,234,567.89 EUR");
    expect(formatMinor(5, "USD")).toBe("0.05 USD");
  });
});

describe("DataTable params", () => {
  const config = {
    sortable: ["createdAt", "amountMinor"],
    defaultSort: { field: "createdAt", direction: "desc" as const },
    filters: [
      { name: "status", label: "Status", type: "select" as const, options: [{ value: "pending", label: "pending" }] },
      { name: "q", label: "Q", type: "text" as const },
    ],
  };

  it("drops unknown sort fields, filters and select values", () => {
    const params = parseTableParams({ sort: "password", status: "hacked", evil: "1", page: "-3", pageSize: "1000" }, config);
    expect(params).toEqual({ page: 1, pageSize: 25, sort: { field: "createdAt", direction: "desc" }, filters: {} });
  });

  it("keeps valid params and builds links", () => {
    const params = parseTableParams({ sort: "amountMinor", dir: "asc", status: "pending", q: " x ", page: "2", pageSize: "50" }, config);
    expect(params).toEqual({ page: 2, pageSize: 50, sort: { field: "amountMinor", direction: "asc" }, filters: { status: "pending", q: "x" } });
    expect(buildTableHref("/t", params, { page: 3 })).toBe("/t?status=pending&q=x&sort=amountMinor&dir=asc&pageSize=50&page=3");
  });
});

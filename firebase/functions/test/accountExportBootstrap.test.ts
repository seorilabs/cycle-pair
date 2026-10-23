import { expect, test } from "vitest";
import { runInNewContext } from "node:vm";
import {
  accountExportBootstrapHtml,
  accountExportLocale,
} from "../src/services/accountExportBootstrap.js";

test("English export uses English document and download states", () => {
  const html = accountExportBootstrapHtml("public-test-nonce", "en");
  expect(html).toContain('<html lang="en">');
  expect(html).toContain("Cycle Pair data export");
  expect(html).toContain("Preparing your secure download.");
  expect(html).toContain(
    "The download has started. This link cannot be used again."
  );
  expect(html).toContain(
    "The link has expired or has already been used. Request a new link in the app."
  );
  expect(html).not.toContain("사이클 페어");
});

test("Korean export preserves the existing single-use fragment and POST boundary", () => {
  const html = accountExportBootstrapHtml("public-test-nonce", "ko");
  expect(html).toContain('<html lang="ko">');
  expect(html).toContain("사이클 페어 데이터 내보내기");
  expect(html).toContain("location.hash.slice(1)");
  expect(html).toContain('history.replaceState(null,"",location.pathname)');
  expect(html).toContain('method:"POST"');
  expect(html).toContain('Authorization:"Bearer "+token');
  expect(html).toContain('cache:"no-store"');
  expect(html).toContain('credentials:"omit"');
});

async function runBootstrap(
  locale: "ko" | "en",
  ok: boolean,
  token = "a".repeat(43)
) {
  const status = { textContent: "" };
  const requests: {
    url: string;
    options: {
      method: string;
      headers: Record<string, string>;
      cache: string;
      credentials: string;
    };
  }[] = [];
  const history: unknown[][] = [];
  let clicks = 0;
  const link = {
    href: "",
    download: "",
    click() {
      clicks++;
    },
    remove() {},
  };
  const html = accountExportBootstrapHtml("public-test-nonce", locale);
  const script = html.match(
    /<script nonce="public-test-nonce">([\s\S]*?)<\/script>/
  )?.[1];
  if (!script) throw new Error("Expected bootstrap script");
  await runInNewContext(script, {
    URLSearchParams,
    location: {
      hash: `#token=${token}`,
      pathname: "/export",
      search: `?lang=${locale}`,
    },
    history: { replaceState: (...args: unknown[]) => history.push(args) },
    document: {
      getElementById: () => status,
      createElement: () => link,
      body: { appendChild() {} },
    },
    fetch: async (
      url: string,
      options: (typeof requests)[number]["options"]
    ) => {
      requests.push({ url, options });
      return {
        ok,
        blob: async () => ({}),
        headers: { get: () => "cycle-pair-data-export-2026-10-23.json" },
      };
    },
    URL: {
      createObjectURL: () => "blob:public-download",
      revokeObjectURL() {},
    },
    setTimeout: () => 0,
  });
  return {
    status: status.textContent,
    requests,
    history,
    clicks,
    filename: link.download,
  };
}

test.each(["ko", "en"] as const)(
  "%s browser script keeps the token out of URL and starts the file download",
  async (locale) => {
    const result = await runBootstrap(locale, true);
    expect(result.history).toEqual([[null, "", "/export"]]);
    expect(result.requests).toEqual([
      {
        url: "/export",
        options: {
          method: "POST",
          headers: {
            Authorization: `Bearer ${"a".repeat(43)}`,
            Accept: "application/json",
          },
          cache: "no-store",
          credentials: "omit",
        },
      },
    ]);
    expect(result.clicks).toBe(1);
    expect(result.filename).toBe("cycle-pair-data-export-2026-10-23.json");
    expect(result.status).toBe(
      locale === "en"
        ? "The download has started. This link cannot be used again."
        : "다운로드를 시작했습니다. 이 링크는 다시 사용할 수 없습니다."
    );
  }
);

test("English refusal and malformed fragment do not start a download", async () => {
  const used = await runBootstrap("en", false);
  expect(used.clicks).toBe(0);
  expect(used.status).toBe(
    "The link has expired or has already been used. Request a new link in the app."
  );
  const malformed = await runBootstrap("en", true, "invalid");
  expect(malformed.requests).toEqual([]);
  expect(malformed.clicks).toBe(0);
  expect(malformed.status).toBe("The download link is invalid.");
});

test("GET locale accepts the legacy default and rejects ambiguous languages", () => {
  expect(accountExportLocale(undefined)).toBe("ko");
  for (const value of [["en", "ko"], { lang: "en" }, "fr", null]) {
    expect(() => accountExportLocale(value)).toThrow();
  }
});

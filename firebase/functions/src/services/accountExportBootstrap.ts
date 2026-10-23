import { AccountPolicyError } from "../domain/accountLifecycle.js";

export type AccountExportLocale = "ko" | "en";

export function accountExportLocale(value: unknown): AccountExportLocale {
  if (value === undefined) return "ko";
  if (value === "ko" || value === "en") return value;
  throw new AccountPolicyError(
    "invalid-argument",
    "Unsupported export language."
  );
}

export function accountExportBootstrapHtml(
  nonce: string,
  locale: AccountExportLocale
): string {
  const copy =
    locale === "en"
      ? {
          title: "Cycle Pair data export",
          preparing: "Preparing your secure download.",
          invalid: "The download link is invalid.",
          started: "The download has started. This link cannot be used again.",
          unavailable:
            "The link has expired or has already been used. Request a new link in the app.",
        }
      : {
          title: "사이클 페어 데이터 내보내기",
          preparing: "보안 다운로드를 준비하고 있습니다.",
          invalid: "다운로드 링크가 올바르지 않습니다.",
          started:
            "다운로드를 시작했습니다. 이 링크는 다시 사용할 수 없습니다.",
          unavailable:
            "링크가 만료되었거나 이미 사용되었습니다. 앱에서 새 링크를 요청해 주세요.",
        };
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${
    copy.title
  }</title></head>
<body><main><h1>${copy.title}</h1><p id="status">${copy.preparing}</p></main>
<script nonce="${nonce}">
(async()=>{const status=document.getElementById("status");const params=new URLSearchParams(location.hash.slice(1));const token=params.get("token");history.replaceState(null,"",location.pathname);if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token)){status.textContent=${JSON.stringify(
    copy.invalid
  )};return;}try{const response=await fetch(location.pathname,{method:"POST",headers:{Authorization:"Bearer "+token,Accept:"application/json"},cache:"no-store",credentials:"omit"});if(!response.ok){throw new Error("download rejected");}const blob=await response.blob();const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=response.headers.get("x-cycle-pair-filename")||"cycle-pair-data-export.json";document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000);status.textContent=${JSON.stringify(
    copy.started
  )};}catch{status.textContent=${JSON.stringify(copy.unavailable)};}})();
</script></body></html>`;
}

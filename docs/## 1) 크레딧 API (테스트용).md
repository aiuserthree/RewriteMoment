## 1) 크레딧 API (테스트용)

### 1-1) `app/api/credits/balance/route.ts`

```ts
import { NextResponse } from "next/server";
import { getCreditBalance } from "@/lib/credits/ledger";

export async function POST(req: Request) {
  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const balance = await getCreditBalance(userId);
  return NextResponse.json({ userId, balance });
}
```

### 1-2) `app/api/credits/purchase/route.ts` (테스트 충전)

```ts
import { NextResponse } from "next/server";
import { applyCreditDelta } from "@/lib/credits/ledger";

export async function POST(req: Request) {
  const { userId, amount } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const amt = Number(amount ?? 0);
  if (!Number.isFinite(amt) || amt <= 0) return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });

  // idemKey: 테스트에서는 timestamp로. 실결제에서는 PG 트랜잭션ID로 고정해야 함.
  const idemKey = `purchase:${userId}:${Date.now()}`;

  await applyCreditDelta({
    userId,
    delta: amt,
    reason: "PURCHASE",
    idemKey
  });

  return NextResponse.json({ ok: true, userId, credited: amt });
}
```

---

## 2) 클라이언트 유틸: fetch 헬퍼

### 2-1) `lib/client/api.ts`

```ts
export async function postJSON<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `Request failed: ${res.status}`);
  return data;
}

export async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "GET" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `Request failed: ${res.status}`);
  return data;
}
```

---

## 3) UI 1: 업로드 페이지 (`/app/upload/page.tsx`)

* 파일 1~3장 선택
* presign 받기 → PUT 업로드
* 업로드 완료 publicUrl로 Draft 생성
* `/select?draftJobId=...`로 이동

```tsx
"use client";

import { useState } from "react";
import { postJSON } from "@/lib/client/api";
import { useRouter } from "next/navigation";

// MVP: userId를 임시로 하드코딩/로컬스토리지로
const USER_ID = "demo-user";

type PresignRes = { key: string; uploadUrl: string; publicUrl: string };

export default function UploadPage() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function uploadAll() {
    setBusy(true);
    setErr(null);
    try {
      if (files.length < 1 || files.length > 3) throw new Error("사진은 1~3장 업로드해줘.");

      const photoUrls: string[] = [];
      for (const f of files) {
        const presign = await postJSON<PresignRes>("/api/upload/presign", {
          userId: USER_ID,
          mime: f.type,
          size: f.size
        });

        const put = await fetch(presign.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": f.type },
          body: f
        });
        if (!put.ok) throw new Error("업로드 실패: presigned PUT");

        photoUrls.push(presign.publicUrl);
      }

      const draft = await postJSON<{ draftJobId: string }>("/api/jobs/draft", {
        userId: USER_ID,
        photoUrls
      });

      router.push(`/select?draftJobId=${draft.draftJobId}`);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>사진 업로드</h1>
      <p>정면/밝은 사진 1~3장이 가장 잘 나와요.</p>

      <input
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))}
        disabled={busy}
      />

      <div style={{ marginTop: 12 }}>
        선택된 파일: {files.length}개
      </div>

      {err && <div style={{ color: "crimson", marginTop: 12 }}>{err}</div>}

      <button
        onClick={uploadAll}
        disabled={busy || files.length === 0}
        style={{ marginTop: 16, padding: "10px 14px", borderRadius: 10 }}
      >
        {busy ? "업로드 중..." : "다음"}
      </button>

      <div style={{ marginTop: 24, fontSize: 12, opacity: 0.8 }}>
        결과물은 가상의 창작물(Fiction/Simulation)입니다.
      </div>
    </div>
  );
}
```

---

## 4) UI 2: 선택 + Rewrite (`/app/select/page.tsx`)

* `draftJobId` 받아서 mode/stage/genre/sliders/rewrite 입력
* Confirm 호출 → 결과 페이지로 이동

```tsx
"use client";

import { useMemo, useState } from "react";
import { postJSON } from "@/lib/client/api";
import { useRouter, useSearchParams } from "next/navigation";

const USER_ID = "demo-user";

const STAGES = [
  { value: "teen", label: "청소년" },
  { value: "twenties", label: "20대" },
  { value: "newlywed", label: "신혼" },
  { value: "early_parenting", label: "초기 육아" }
];

const GENRES = [
  { value: "docu", label: "다큐" },
  { value: "comedy", label: "코미디" },
  { value: "drama", label: "드라마" },
  { value: "melo", label: "멜로" },
  { value: "fantasy", label: "판타지" }
];

// 무료/유료 분리 확정:
// quick 무료, story/trailer 유료
const MODES = [
  { value: "quick", label: "무료 Quick (8초×3)" },
  { value: "story", label: "유료 Story (15초×3)" },
  { value: "trailer", label: "유료 Trailer (45~60초×1)" }
];

export default function SelectPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const draftJobId = sp.get("draftJobId");

  const [mode, setMode] = useState<"quick"|"story"|"trailer">("quick");
  const [stage, setStage] = useState("teen");
  const [genre, setGenre] = useState("comedy");
  const [realism, setRealism] = useState(0.6);
  const [intensity, setIntensity] = useState(0.4);
  const [pace, setPace] = useState(0.7);

  const [rewriteEnabled, setRewriteEnabled] = useState(false);
  const [rewriteText, setRewriteText] = useState("");
  const [distanceMode, setDistanceMode] = useState("similar");
  const [desiredEnding, setDesiredEnding] = useState("growth");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const slidersJson = useMemo(() => ({ realism, intensity, pace }), [realism, intensity, pace]);

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      if (!draftJobId) throw new Error("draftJobId가 없어. 업로드부터 다시 진행해줘.");

      const res = await postJSON<{ jobId: string }>("/api/jobs/confirm", {
        userId: USER_ID,
        draftJobId,
        mode,
        stage,
        genre,
        slidersJson,
        rewriteEnabled,
        rewriteRawText: rewriteText,
        distanceMode,
        desiredEnding
      });

      router.push(`/result/${res.jobId}`);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>선택</h1>

      <label>길이</label>
      <select value={mode} onChange={(e) => setMode(e.target.value as any)} disabled={busy}>
        {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label>스테이지</label>
          <select value={stage} onChange={(e) => setStage(e.target.value)} disabled={busy}>
            {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label>장르</label>
          <select value={genre} onChange={(e) => setGenre(e.target.value)} disabled={busy}>
            {GENRES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div>현실감: {realism.toFixed(2)}</div>
        <input type="range" min="0" max="1" step="0.01" value={realism} onChange={(e) => setRealism(Number(e.target.value))} />
        <div>강도: {intensity.toFixed(2)}</div>
        <input type="range" min="0" max="1" step="0.01" value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} />
        <div>속도: {pace.toFixed(2)}</div>
        <input type="range" min="0" max="1" step="0.01" value={pace} onChange={(e) => setPace(Number(e.target.value))} />
      </div>

      <hr style={{ margin: "20px 0" }} />

      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={rewriteEnabled} onChange={(e) => setRewriteEnabled(e.target.checked)} />
        Rewrite Moment(선택): 잊지 못하는 사건을 다른 결말로
      </label>

      {rewriteEnabled && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            실명/학교/회사/주소는 적지 말아주세요. 유사 상황으로 재구성됩니다.
          </div>
          <textarea
            value={rewriteText}
            onChange={(e) => setRewriteText(e.target.value)}
            placeholder="예: 그날 발표에서 너무 창피했어…"
            rows={4}
            style={{ width: "100%", marginTop: 8 }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
            <div>
              <label>거리두기</label>
              <select value={distanceMode} onChange={(e) => setDistanceMode(e.target.value)}>
                <option value="symbolic">상징적으로(안전)</option>
                <option value="similar">유사 상황</option>
                <option value="quite_similar">꽤 비슷하게</option>
              </select>
            </div>
            <div>
              <label>바꿀 결말</label>
              <select value={desiredEnding} onChange={(e) => setDesiredEnding(e.target.value)}>
                <option value="recovery">회복</option>
                <option value="growth">성장</option>
                <option value="reconcile">화해</option>
                <option value="self_protect">자기보호</option>
                <option value="new_start">새출발</option>
                <option value="comedy">코미디 승화</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {err && <div style={{ color: "crimson", marginTop: 12 }}>{err}</div>}

      <button onClick={confirm} disabled={busy} style={{ marginTop: 16, padding: "10px 14px", borderRadius: 10 }}>
        {busy ? "생성 요청 중..." : "생성하기"}
      </button>

      <div style={{ marginTop: 18, fontSize: 12, opacity: 0.8 }}>
        유료 모드는 크레딧이 필요합니다(Story=2, Trailer=5, Rewrite=+1).
      </div>
    </div>
  );
}
```

---

## 5) UI 3: 결과 페이지 (`/app/result/[jobId]/page.tsx`)

* 폴링해서 status 확인
* Quick/Story: clip 1~3 표시
* Trailer: trailerUrl 표시
* Quick 결과에서 **업그레이드 버튼** 제공 → 같은 사진으로 새 Draft 만들고 Story/Trailer로 confirm

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { getJSON, postJSON } from "@/lib/client/api";
import { useParams, useRouter } from "next/navigation";

const USER_ID = "demo-user";

type JobRes = {
  id: string;
  mode: "quick"|"story"|"trailer";
  stage: string;
  genre: string;
  status: string;
  photos: string[];
  rewrite: { enabled: boolean; distanceMode?: string; desiredEnding?: string };
  result: any;
};

export default function ResultPage() {
  const params = useParams<{ jobId: string }>();
  const router = useRouter();
  const jobId = params.jobId;

  const [data, setData] = useState<JobRes | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function fetchJob() {
    try {
      const d = await getJSON<JobRes>(`/api/jobs/${jobId}`);
      setData(d);
      setErr(null);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  }

  useEffect(() => {
    fetchJob();
    const t = setInterval(fetchJob, 1500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const ready = data?.status === "done";

  async function upgradeTo(mode: "story"|"trailer") {
    if (!data) return;
    // (1) 기존 photos로 새 draft 생성
    const draft = await postJSON<{ draftJobId: string }>("/api/jobs/draft", {
      userId: USER_ID,
      photoUrls: data.photos
    });

    // (2) confirm: 기존 stage/genre 유지, rewrite 옵션도 유지(원하면 토글 가능)
    const res = await postJSON<{ jobId: string }>("/api/jobs/confirm", {
      userId: USER_ID,
      draftJobId: draft.draftJobId,
      mode,
      stage: data.stage,
      genre: data.genre,
      slidersJson: { realism: 0.6, intensity: 0.4, pace: 0.7 },
      rewriteEnabled: data.rewrite?.enabled ?? false,
      // rewriteRawText는 서버에 저장된 게 draft에 없으니, MVP는 업그레이드 시 rewrite는 꺼도 됨.
      // 유지하고 싶으면: 결과 API에서 sanitizedText를 내려주고, confirm에 rewriteRawText로 다시 넘기면 됨.
      rewriteRawText: "",
      distanceMode: data.rewrite?.distanceMode ?? "similar",
      desiredEnding: data.rewrite?.desiredEnding ?? "growth"
    });

    router.push(`/result/${res.jobId}`);
  }

  async function addCredits(amount: number) {
    await postJSON("/api/credits/purchase", { userId: USER_ID, amount });
    alert(`크레딧 +${amount} 충전됨(테스트)`);
  }

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>결과</h1>
      <div style={{ marginTop: 8, opacity: 0.85 }}>
        status: <b>{data?.status ?? "loading..."}</b>
      </div>
      {err && <div style={{ color: "crimson", marginTop: 12 }}>{err}</div>}

      {!ready && <div style={{ marginTop: 16 }}>생성 중…(자동 새로고침)</div>}

      {ready && data && (
        <>
          {data.mode === "trailer" ? (
            <div style={{ marginTop: 16 }}>
              <h3>Trailer</h3>
              {data.result?.trailerUrl ? (
                <video src={data.result.trailerUrl} controls style={{ width: "100%", borderRadius: 12 }} />
              ) : (
                <div>트레일러 URL이 없습니다.</div>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <h3>Clips</h3>
              {data.result?.clips?.map((c: any) => (
                <div key={c.clipNo} style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 600 }}>Clip {c.clipNo}</div>
                  {c.videoUrl ? (
                    <video src={c.videoUrl} controls style={{ width: "100%", borderRadius: 12 }} />
                  ) : (
                    <div>클립 URL이 없습니다.</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 업그레이드: Quick에서만 강하게 노출 */}
          {data.mode === "quick" && (
            <div style={{ marginTop: 20, padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
              <div style={{ fontWeight: 700 }}>더 길게 만들기</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 6 }}>
                Story(15초×3)는 전환/반전이 더 살아나고, Trailer는 예고편처럼 이어집니다.
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <button onClick={() => upgradeTo("story")} style={{ padding: "10px 12px", borderRadius: 10 }}>
                  15초 Story로 업그레이드
                </button>
                <button onClick={() => upgradeTo("trailer")} style={{ padding: "10px 12px", borderRadius: 10 }}>
                  60초 Trailer 만들기
                </button>
              </div>

              <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8 }}>
                테스트: 크레딧이 없으면 402가 떨어져요.
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => addCredits(10)} style={{ padding: "8px 10px", borderRadius: 10 }}>
                  크레딧 +10(테스트)
                </button>
                <button onClick={() => addCredits(50)} style={{ padding: "8px 10px", borderRadius: 10 }}>
                  크레딧 +50(테스트)
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

> 업그레이드 시 Rewrite를 유지하고 싶으면:

* `GET /api/jobs/:jobId`에서 `rewriteInput.sanitizedText` 또는 `rawText`를 내려주고
* `confirm`에 `rewriteRawText`로 다시 보내면 돼(지금은 MVP 단순화를 위해 공란 처리).

---

## 6) 라우트 연결(최소)

* `/upload` → 업로드 페이지
* `/select?draftJobId=...` → 선택/Rewrite
* `/result/[jobId]` → 결과/업그레이드

원하면 `/app/page.tsx`를 `/upload`로 리다이렉트시키면 편함.

```tsx
// app/page.tsx
import { redirect } from "next/navigation";
export default function Home() {
  redirect("/upload");
}
```

---

## 7) 지금 상태에서 “완전 end-to-end” 체크리스트

1. `prisma migrate dev`
2. `prisma db seed`
3. Redis 켜기
4. Worker 실행(`tsx lib/queue/worker.ts`)
5. Next 실행
6. `/upload`에서 1~3장 업로드 → Quick 생성 → 결과 클립 3개가 뜨면 성공(stub URL)

---



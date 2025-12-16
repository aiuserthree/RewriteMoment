## 1) Cursor 작업 순서 (이대로 하면 됨)

### Step 1) 레포 스캐폴딩

* Next.js(App Router) + TypeScript
* Prisma(Postgres) + NextAuth(or Clerk) 중 택1
* 업로드: S3(or R2) + presigned URL
* 잡큐: BullMQ + Redis (로컬은 Docker로)

### Step 2) “스펙 문서”를 코드베이스에 고정

Cursor가 흔들리지 않게, 아래 파일 2개를 먼저 만들어.

* `docs/PRD.md` : 지금까지 확정된 제품/정책/크레딧 요약
* `docs/TEMPLATES.md` : 템플릿 생성 규칙(60/60/20, stage×genre 분포, 시그니처 해시)

### Step 3) 템플릿 라이브러리부터 완성

* 템플릿을 DB에 시드해두면, UI/생성 파이프라인이 전부 “템플릿 선택” 기반으로 안정화됨.

### Step 4) 화면 4개 + 잡 생성만 먼저 (실제 영상 생성은 stub로)

* 업로드 → 선택 → Rewrite → 결과
* 결과는 일단 “더미 영상 URL”로 꽂고, 파이프라인은 worker에서 나중에 붙임

### Step 5) 크레딧 차감/장부(ledger) 먼저

* 나중에 과금 붙일 때 폭발하는 부분이라 먼저 고정하는 게 정답.

---

## 2) 추천 폴더 구조

```
/app
  /api
    /jobs
    /credits
    /upload
  /(routes)
    /upload
    /select
    /rewrite
    /result/[jobId]
/lib
  /templates
    generator.ts
    types.ts
    seed.ts
  /credits
    ledger.ts
  /safety
    sanitize.ts
    ipFilter.ts
  /queue
    client.ts
    worker.ts
/prisma
  schema.prisma
  seed.ts
/docs
  PRD.md
  TEMPLATES.md
```

---

## 3) Prisma 스키마 (핵심만)

`prisma/schema.prisma`

```prisma
model User {
  id           String   @id @default(cuid())
  email        String?  @unique
  createdAt    DateTime @default(now())
  jobs         Job[]
  creditLedger CreditLedger[]
}

model CreditLedger {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  delta     Int
  reason    String
  refJobId  String?
  idemKey   String   @unique
  createdAt DateTime @default(now())
}

model Job {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  mode          String   // quick|story|trailer
  stage         String   // teen|twenties|newlywed|early_parenting
  genre         String   // docu|comedy|drama|melo|fantasy
  slidersJson   Json
  rewriteEnabled Boolean @default(false)
  status        String   @default("queued")
  createdAt     DateTime @default(now())
  rewriteInput  RewriteInput?
  assets        Asset[]
}

model RewriteInput {
  jobId         String  @id
  job           Job     @relation(fields: [jobId], references: [id])
  rawText       String
  sanitizedText String
  distanceMode  String
  desiredEnding String
}

model Asset {
  id          String   @id @default(cuid())
  jobId       String
  job         Job      @relation(fields: [jobId], references: [id])
  type        String   // image|video|thumb|zip
  url         String
  metadataJson Json?
  createdAt   DateTime @default(now())
}

model Template {
  id          String   @id @default(cuid())
  mode        String   // quick|story|trailer
  stage       String
  genre       String
  signature   String   @unique
  bodyJson    Json
  createdAt   DateTime @default(now())
}
```

---

## 4) 템플릿 60/60/20 자동 생성기 (TypeScript 버전)

`/lib/templates/generator.ts`

```ts
import crypto from "crypto";

type Mode = "quick" | "story" | "trailer";
type Stage = "teen" | "twenties" | "newlywed" | "early_parenting";
type Genre = "docu" | "comedy" | "drama" | "melo" | "fantasy";

type Template = {
  mode: Mode;
  format: "vertical_9_16";
  stage: Stage;
  genre: Genre;
  sliders: { realism: number; intensity: number; pace: number };
  clips: any[];
  signature: string;
};

const STAGES: Record<Stage, any> = {
  teen: {
    anchors: ["classroom","hallway","festival_stage","rainy_walk","sports_day"],
    props: ["notebook","test_paper","mic","trophy","school_bell"],
    conflicts: ["presentation_mess","misunderstanding","lost_item","small_rivalry","surprise_task"],
    endings: ["unexpected_applause","friend_support","self_laugh","new_try"],
    familyRule: null
  },
  twenties: {
    anchors: ["interview_room","elevator_mirror","night_bus","tiny_studio","convenience_store"],
    props: ["resume","badge","laptop","coffee","street_lights"],
    conflicts: ["deadline","awkward_meeting","tiny_mistake","small_win","missed_alarm"],
    endings: ["one_step_forward","comic_relief","calm_acceptance","new_choice"],
    familyRule: null
  },
  newlywed: {
    anchors: ["new_apartment","kitchen","moving_boxes","laundry_day","weekend_outing"],
    props: ["boxes","dishes","memo_note","calendar","small_gift"],
    conflicts: ["housework_mismatch","cooking_fail","budget_day","tiny_argument","surprise_event"],
    endings: ["hand_hold","laugh_together","warm_makeup","cozy_home"],
    familyRule: "partner_silhouette"
  },
  early_parenting: {
    anchors: ["dawn_kitchen","toy_livingroom","stroller_walk","generic_clinic","night_lullaby"],
    props: ["bottle","stroller","tiny_socks","diaper_bag","sticky_notes"],
    conflicts: ["sleepy_chaos","missing_item","schedule_panic","tiny_scare_then_relief","teamwork_day"],
    endings: ["morning_light","small_victory","gentle_hug_silhouette","calm_reset"],
    familyRule: "baby_no_detail"
  },
};

const GENRES: Record<Genre, any> = {
  docu:   { camera:"handheld, observational", color:"natural", pace:"medium", caption:"lower-third + plain" },
  comedy: { camera:"snappy cuts, reaction shots", color:"bright", pace:"fast", caption:"punchline" },
  drama:  { camera:"steady cinematic, close emotion", color:"warm", pace:"medium-slow", caption:"emotional" },
  melo:   { camera:"slow push-in, close-up", color:"pastel", pace:"slow", caption:"letter-like" },
  fantasy:{ camera:"wide wonder shots", color:"dreamy", pace:"medium", caption:"mystical" },
};

const HOOK_CAPS = ["하필 오늘…", "잠깐만… 뭐지?", "이 순간이 시작이었다", "괜찮아, 심호흡"];
const MAIN_CAPS = ["망했다", "큰일 났다", "내가 왜 그랬지", "잠깐만… 다시"];
const END_CAPS  = ["근데… 의외로", "그래도 괜찮아", "다음엔 더 잘할 거야", "이상하게 웃음이 났다"];

const MODES: Mode[] = ["quick","story","trailer"];
const STAGE_LIST: Stage[] = ["teen","twenties","newlywed","early_parenting"];
const GENRE_LIST: Genre[] = ["docu","comedy","drama","melo","fantasy"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickN<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}
function sigHash(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 12);
}
function ipSafe(text: string): boolean {
  const banned = ["해리포터","마블","디즈니","넷플릭스","지브리","나루토","원피스"];
  return banned.every(b => !text.includes(b));
}

function buildQuick(stage: Stage, genre: Genre, variant: number): Template {
  const st = STAGES[stage];
  const gn = GENRES[genre];

  const hookAnchor = pick(st.anchors);
  const mainConflict = pick(st.conflicts);
  const endingType = pick(st.endings);

  const hookCap = HOOK_CAPS[(variant + Math.floor(Math.random()*10)) % HOOK_CAPS.length];
  const mainCap = MAIN_CAPS[(variant + Math.floor(Math.random()*10)) % MAIN_CAPS.length];
  const endCap  = END_CAPS[(variant + Math.floor(Math.random()*10)) % END_CAPS.length];

  if (![hookCap, mainCap, endCap].every(ipSafe)) throw new Error("IP unsafe caption");

  const baseRules = ["no logos","no famous IP","no real names"];
  const rules = st.familyRule ? [...baseRules, st.familyRule] : baseRules;

  const clips = [
    { clip_no:1, role:"hook", duration_sec:8,
      scene:{ location:hookAnchor, time:"daytime", action:"setup moment", emotion:"anticipation",
             camera:gn.camera, visual_rules:rules },
      caption:hookCap },
    { clip_no:2, role:"main", duration_sec:8,
      scene:{ location:hookAnchor, time:"same day", action:`conflict: ${mainConflict}`, emotion:"chaos",
             camera:gn.camera, visual_rules:rules },
      caption:mainCap },
    { clip_no:3, role:"ending", duration_sec:8,
      scene:{ location:hookAnchor, time:"after", action:`resolve: ${endingType}`, emotion:"relief",
             camera:gn.camera, visual_rules:rules },
      caption:endCap },
  ];

  const signatureRaw = `${stage}|${genre}|${hookAnchor}|${mainConflict}|${endingType}|Q${variant}`;
  return {
    mode:"quick",
    format:"vertical_9_16",
    stage, genre,
    sliders:{ realism:0.6, intensity:0.4, pace:0.7 },
    clips,
    signature: sigHash(signatureRaw),
  };
}

function buildStory(stage: Stage, genre: Genre, variant: number): Template {
  const st = STAGES[stage];
  const gn = GENRES[genre];
  const [a1, a2] = pickN(st.anchors, 2);
  const conflict = pick(st.conflicts);
  const ending = pick(st.endings);

  const baseRules = ["no logos","no famous IP","no real names"];
  const rules = st.familyRule ? [...baseRules, st.familyRule] : baseRules;

  const mkClip = (clipNo: number, role: "hook"|"main"|"ending", anchor: string, focus: string) => ({
    clip_no: clipNo,
    role,
    duration_sec: 15,
    scene: {
      location: anchor,
      time: "varies",
      action: `beat1 setup → beat2 tension → beat3 turn (${focus})`,
      emotion: "mixed",
      camera: gn.camera,
      visual_rules: rules,
    },
    caption: role === "hook" ? pick(HOOK_CAPS) : role === "main" ? pick(MAIN_CAPS) : pick(END_CAPS),
  });

  const clips = [
    mkClip(1,"hook",a1,"start"),
    mkClip(2,"main",a2,`conflict: ${conflict}`),
    mkClip(3,"ending",a1,`ending: ${ending}`),
  ];

  const signatureRaw = `${stage}|${genre}|${a1}|${a2}|${conflict}|${ending}|S${variant}`;
  return {
    mode:"story",
    format:"vertical_9_16",
    stage, genre,
    sliders:{ realism:0.6, intensity:0.4, pace:0.7 },
    clips,
    signature: sigHash(signatureRaw),
  };
}

function buildTrailer(stage: Stage, genre: Genre): Template {
  const st = STAGES[stage];
  const gn = GENRES[genre];
  const trigger = pick(st.conflicts);
  const moment = pick(st.anchors);
  const ending = pick(st.endings);
  const sceneCount = pick([6,7,8,9,10]);

  const baseRules = ["no logos","no famous IP","no real names"];
  const rules = st.familyRule ? [...baseRules, st.familyRule] : baseRules;

  const clips: any[] = [];
  clips.push({
    clip_no: 1,
    role: "trailer_scene",
    duration_sec: 5,
    title_card: "ORIGINAL TITLE",
    scene: { location:"title_card", time:"", action:"title", emotion:"", camera:"static", visual_rules:["fiction/simulation"] },
    caption: ""
  });

  for (let i=2; i<sceneCount; i++) {
    const loc = pick(st.anchors);
    const action = i < 4 ? "intro/day-in-life" : (i === 4 ? `trigger: ${trigger}` : `moment: ${loc}`);
    clips.push({
      clip_no: i,
      role: "trailer_scene",
      duration_sec: 6,
      scene: { location: loc, time:"varies", action, emotion:"rising", camera: gn.camera, visual_rules: rules },
      caption: ""
    });
  }

  clips.push({
    clip_no: sceneCount,
    role: "trailer_scene",
    duration_sec: 6,
    scene: { location: moment, time:"after", action:`resolve: ${ending}`, emotion:"release", camera: gn.camera, visual_rules: rules },
    caption: ""
  });

  const signatureRaw = `${stage}|${genre}|${trigger}|${moment}|${ending}|T${sceneCount}`;
  return {
    mode:"trailer",
    format:"vertical_9_16",
    stage, genre,
    sliders:{ realism:0.6, intensity:0.4, pace:0.7 },
    clips,
    signature: sigHash(signatureRaw),
  };
}

export function generateLibrary(): { quick: Template[]; story: Template[]; trailer: Template[] } {
  const quick: Template[] = [];
  const story: Template[] = [];
  const trailer: Template[] = [];
  const seen = new Set<string>();

  // 분포 규칙: (stage,genre)당 quick 3 + story 3 + trailer 1
  for (const stage of STAGE_LIST) {
    for (const genre of GENRE_LIST) {
      // quick 3
      let vq = 0;
      while (quick.filter(t => t.stage===stage && t.genre===genre).length < 3) {
        const t = buildQuick(stage, genre, vq++);
        if (seen.has(t.signature)) continue;
        seen.add(t.signature);
        quick.push(t);
      }
      // story 3
      let vs = 0;
      while (story.filter(t => t.stage===stage && t.genre===genre).length < 3) {
        const t = buildStory(stage, genre, vs++);
        if (seen.has(t.signature)) continue;
        seen.add(t.signature);
        story.push(t);
      }
      // trailer 1
      while (trailer.filter(t => t.stage===stage && t.genre===genre).length < 1) {
        const t = buildTrailer(stage, genre);
        if (seen.has(t.signature)) continue;
        seen.add(t.signature);
        trailer.push(t);
      }
    }
  }

  if (quick.length !== 60) throw new Error(`quick != 60 (${quick.length})`);
  if (story.length !== 60) throw new Error(`story != 60 (${story.length})`);
  if (trailer.length !== 20) throw new Error(`trailer != 20 (${trailer.length})`);

  return { quick, story, trailer };
}
```

---

## 5) DB 시드 코드 (Prisma)

`/prisma/seed.ts`

```ts
import { PrismaClient } from "@prisma/client";
import { generateLibrary } from "../lib/templates/generator";

const prisma = new PrismaClient();

async function main() {
  const { quick, story, trailer } = generateLibrary();
  const all = [...quick, ...story, ...trailer];

  for (const t of all) {
    await prisma.template.upsert({
      where: { signature: t.signature },
      update: { mode: t.mode, stage: t.stage, genre: t.genre, bodyJson: t as any },
      create: { mode: t.mode, stage: t.stage, genre: t.genre, signature: t.signature, bodyJson: t as any },
    });
  }

  console.log(`Seeded templates: ${all.length}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => prisma.$disconnect());
```

---

## 6) 생성 시 “템플릿 선택” 규칙

런타임에서 job 생성할 때는:

* `mode + stage + genre`로 템플릿 후보를 가져오고
* 그중 랜덤 1개 선택(또는 “슬라이더 값”으로 pace/intensity가 높은 템플릿 우선)

예:

* Quick/Story: (stage,genre)당 3개 중 하나 랜덤
* Trailer: (stage,genre)당 1개 고정 (초기엔 안정적)

---

## 7) Cursor에서 바로 쓰는 프롬프트(복붙용)

Cursor 채팅에 이렇게 시키면 거의 자동으로 파일이 채워져.

1. **스키마/시드**

> “`prisma/schema.prisma`에 User/CreditLedger/Job/RewriteInput/Asset/Template 모델을 추가하고, `prisma/seed.ts`에서 `lib/templates/generator.ts`로 생성한 140개 템플릿을 upsert로 시드해줘. 마이그레이션과 seed 실행 방법도 README에 추가해줘.”

2. **템플릿 API**

> “`GET /api/templates?mode=&stage=&genre=`로 템플릿 리스트 반환. `POST /api/jobs`에서 선택된 mode/stage/genre로 템플릿 하나 고르고 Job을 생성, status queued로 저장해줘.”

3. **크레딧 장부(중요)**

> “`lib/credits/ledger.ts`를 만들고, credit_ledger에 idemKey 기반으로 중복 차감 방지하면서 Story=2, Trailer=5, Rewrite=+1, Story 재생성=1, Trailer 장면 재생성=1 규칙으로 차감 함수 만들어줘.”



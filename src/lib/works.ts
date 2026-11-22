/**
 * 作品データ。トップの Featured Works と /works の両方がここを読む。
 *
 * 掲載ルール: 開始時期・稼働状況・自作範囲は、各リポジトリの作成日・
 * contributors・デプロイ設定・README から確認できる事実だけを書く。
 * 利用者数のように確認できないものは書かない。
 */

export type WorkStatus = "live" | "demo" | "private";

export interface Work {
  slug: string;
  name: string;
  /** 一言で何か（見出し直下の1行） */
  tagline: string;
  /** 何を解決したか・どう作ったか（80字程度） */
  summary: string;
  status: WorkStatus;
  /** 状態の補足（例: 決済機能は無効化） */
  statusNote?: string;
  /** リポジトリ作成月。"YYYY.MM" */
  since: string;
  /** 自分が担った範囲 */
  scope: string;
  /** どう動かしているか。運用していない作品は undefined */
  operation?: string;
  stack: string[];
  links: {
    live?: string;
    /** 配布物の公開先。ゲームのように Web サイトを持たない作品で使う */
    download?: string;
    /** ソースを公開している作品のリポジトリ */
    repo?: string;
    caseSlug?: string;
  };
  /**
   * スクリーンショット。画面幅ごとに別の絵を持つ。
   * スマホで見る人には縦長の実機画面を、広い画面では横長の画面を見せる
   * （1 枚を横長枠に収めると、縦長のスクショが枠幅の 1/4 しか使えず
   * 左右が大きな空白になる）。画像が無い作品は構成の要約を代わりに出す。
   */
  image?: {
    alt: string;
    /** 横長。デスクトップの画面比に合わせる */
    desktop: { src: string; width: number; height: number };
    /** 縦長。実機の画面比に合わせる */
    mobile: { src: string; width: number; height: number };
    /** サイトをダークにしたときに差し替える画像（任意） */
    dark?: {
      desktop: { src: string; width: number; height: number };
      mobile: { src: string; width: number; height: number };
    };
  };
  architecture?: string[];
  featured: boolean;
}

export const works: Work[] = [
  {
    slug: "smoke-it",
    name: "Smoke it.",
    tagline: "3D の箱から 1 本ずつ記録する、AI コーチ付きの喫煙記録 PWA",
    summary:
      "開けた箱を 3D で表示し、1 本取り出して着火から灰皿まで演出付きで記録する。箱棚や写真ギャラリー、期間別の傾向と支出を一覧でき、記録を踏まえて AI コーチに相談できる。OAuth 2.1 で認可する MCP サーバーから、AI エージェントでも記録を読み書きできる。",
    status: "live",
    since: "2025.12",
    scope: "企画・設計・実装・デプロイ（単独開発）",
    operation: "GitHub Actions でビルドし、自宅 Proxmox 上の Docker にデプロイ",
    stack: ["TanStack Start", "Three.js", "PWA", "PostgreSQL / Prisma", "OpenRouter", "MCP"],
    links: { live: "https://smoke-it.koshikai.dev", caseSlug: "smoke-it" },
    image: {
      alt: "Smoke it. のホーム画面。今日の本数と支出、机の上の 3D の箱・写真立て・灰皿",
      // 同じファイル名で画像を差し替えたら v を更新する（Cloudflare が 4 時間キャッシュするため）
      desktop: { src: "/images/projects/smoke-it-light-desktop.webp?v=2", width: 1424, height: 900 },
      mobile: { src: "/images/projects/smoke-it-light-mobile.webp", width: 780, height: 1520 },
      dark: {
        desktop: { src: "/images/projects/smoke-it-dark-desktop.webp?v=2", width: 1424, height: 900 },
        mobile: { src: "/images/projects/smoke-it-dark-mobile.webp", width: 780, height: 1520 },
      },
    },
    featured: true,
  },
  {
    slug: "karigallery",
    name: "KariGallery",
    tagline: "イラスト作品の展示・管理ギャラリー",
    summary:
      "友人のイラストを一か所で管理・公開するために制作。Stripe Checkout の決済フローまで実装・検証したうえで、法的手続きの負荷を踏まえて本番決済は行わない判断をした。",
    status: "demo",
    statusNote: "決済機能を無効化したデモとして公開",
    since: "2025.10",
    scope: "設計・実装・デプロイ（単独開発）",
    operation: "GitHub Actions でビルドし、自宅 Proxmox 上の Docker にデプロイ",
    stack: ["TanStack Start", "Auth.js", "Stripe", "Prisma"],
    links: { live: "https://gallery.koshikai.dev", caseSlug: "karigallery" },
    image: {
      alt: "KariGallery のランディングページ",
      desktop: { src: "/images/projects/karigallery-desktop.webp", width: 1424, height: 900 },
      mobile: { src: "/images/projects/karigallery-mobile.webp", width: 780, height: 1688 },
    },
    featured: true,
  },
  {
    slug: "sunny-room",
    name: "ひだまりマップ",
    tagline: "部屋の窓に日が当たる時間帯を 3D 都市モデル上で確かめる Web アプリ",
    summary:
      "PLATEAU の 3D 都市モデルと太陽位置計算を組み合わせ、周辺建物による遮蔽を含めて、指定した窓の日照時間帯を可視化する。",
    status: "private",
    since: "2026.05",
    scope: "設計・実装（単独開発）",
    stack: ["Next.js", "CesiumJS", "PLATEAU 3D Tiles", "SunCalc"],
    links: {},
    architecture: [
      "住所 → ジオコーディング",
      "PLATEAU 3D Tiles（CesiumJS）",
      "太陽位置（SunCalc）＋ 遮蔽判定",
      "日照タイムライン",
    ],
    featured: false,
  },
  {
    slug: "turbo-circuit",
    name: "Turbo Circuit",
    tagline: "ドリフトとアイテムで競う 3D カートレーシングゲーム",
    summary:
      "ドリフトでブーストを貯め、6 種のアイテムで順位が入れ替わるアーケードレース。7 コース・ドライバー 10 人・カート 8 種に加え、画面分割 2P と最大 8 人のオンライン対戦まで実装した。",
    status: "live",
    statusNote: "Windows 64-bit 版を GitHub Releases で配布",
    since: "2026.10",
    scope: "企画・設計・実装（単独開発）",
    operation: "オンライン対戦は Unity Relay 経由（サーバーの常時運用なし）",
    stack: ["Unity", "C#", "URP", "Unity Relay"],
    links: {
      download: "https://github.com/koshikai/TurboCircuit/releases/latest",
      repo: "https://github.com/koshikai/TurboCircuit",
    },
    image: {
      alt: "Turbo Circuit のレース画面",
      desktop: { src: "/images/projects/turbo-circuit-desktop.webp", width: 1020, height: 645 },
      mobile: { src: "/images/projects/turbo-circuit-mobile.webp", width: 780, height: 1688 },
    },
    featured: true,
  },
];

export const featuredWorks = works.filter((work) => work.featured);

export const STATUS_LABELS: Record<WorkStatus, string> = {
  live: "公開中",
  demo: "デモ公開",
  private: "Private",
};

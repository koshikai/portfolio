/**
 * Engineering（build をどう支え、どう operate しているか）のデータ。
 *
 * 掲載ルール: 実際に使った技術だけを載せる。各行の evidence は、
 * そのツールを使った作品・事例・このサイト自体へのリンクで裏付ける。
 * 監視基盤（observability）は現時点では載せない。
 */

export interface Evidence {
  label: string;
  href: string;
}

export interface Capability {
  area: string;
  tools: string[];
  evidence: Evidence[];
}

const SMOKE_IT: Evidence = { label: "Smoke it.", href: "/cases/smoke-it" };
const KARIGALLERY: Evidence = { label: "KariGallery", href: "/cases/karigallery" };
const RESEARCH_AGENT: Evidence = { label: "研究エージェント", href: "/cases/ai-research-agent" };
const AGENT_OPS: Evidence = { label: "常駐エージェント運用", href: "/cases/agent-operations" };
const THIS_SITE: Evidence = { label: "このサイト", href: "/engineering#pipeline" };
const HOMELAB: Evidence = { label: "Immich の GPU オフロード", href: "/cases/immich-distributed" };
const DEPLOY: Evidence = { label: "デプロイ自動化", href: "/cases/deploy-automation" };
const MATHKB: Evidence = { label: "MathKB", href: "/cases/mathkb" };
const AGENT_PROFILES: Evidence = { label: "5 プロファイル分離", href: "/cases/agent-profiles" };
const SHARED_SKILLS: Evidence = { label: "共有スキルの集約", href: "/cases/shared-skills" };
const SECRETS_BOUNDARY: Evidence = { label: "秘密を見せないログイン", href: "/cases/secrets-boundary" };
const AGENT_BACKUP: Evidence = { label: "状態の日次バックアップ", href: "/cases/agent-state-backup" };
const LCM_MISREAD: Evidence = { label: "圧縮監視の計測取り違え", href: "/cases/lcm-misread" };

export const capabilities: Capability[] = [
  {
    area: "Frontend",
    tools: ["TypeScript", "React", "TanStack Start", "Three.js", "PWA"],
    evidence: [SMOKE_IT, KARIGALLERY, THIS_SITE],
  },
  {
    area: "Backend",
    tools: ["Node.js", "Python", "FastAPI", "Auth.js"],
    evidence: [SMOKE_IT, KARIGALLERY],
  },
  {
    area: "Database",
    tools: ["PostgreSQL", "Prisma", "pgvector"],
    evidence: [SMOKE_IT, KARIGALLERY, MATHKB],
  },
  {
    area: "Infrastructure",
    tools: ["Linux", "Docker", "Proxmox", "Nginx", "self-hosting"],
    evidence: [HOMELAB, THIS_SITE, AGENT_BACKUP],
  },
  {
    area: "CI/CD",
    tools: ["Git", "GitHub Actions", "GHCR", "self-hosted runner"],
    evidence: [DEPLOY, THIS_SITE],
  },
  {
    area: "AI",
    tools: ["LLM", "AI エージェント", "MCP"],
    evidence: [SMOKE_IT, RESEARCH_AGENT, AGENT_OPS, AGENT_PROFILES, SHARED_SKILLS, SECRETS_BOUNDARY, LCM_MISREAD, HOMELAB, MATHKB],
  },
];

/** インフラ・運用の概要 */
export const operationFacts = [
  {
    title: "自宅サーバーへの自動デプロイ",
    body: "このサイト・Smoke it.・KariGallery は、GitHub Actions でビルドしたコンテナイメージを自宅サーバー上の self-hosted runner が Docker Compose でデプロイしています。",
  },
  {
    title: "Proxmox で 10 以上のサービスを運用",
    body: "Proxmox VE と LXC 上で、リバースプロキシ（Nginx Proxy Manager）・DNS フィルタ・写真管理などを共通の手順で管理しています。",
  },
  {
    title: "機械学習処理の GPU オフロード",
    body: "写真管理の機械学習処理だけを GPU のある別マシンへオフロードし、常時稼働サーバーの省電力性と処理性能を両立しました。",
  },
  {
    title: "バックアップと復旧手順の整備",
    body: "写真・動画データの定期バックアップと世代保持方針を定め、障害時の復元手順を文書化しています。",
  },
  {
    title: "常駐エージェントへの定型作業の委譲",
    body: "自宅サーバー上で AI エージェントを常駐させ、差分と履歴の確認・検証コマンドの実行・デプロイ監視を SSH 越しに委譲しています。会話履歴と作業手順は用途別のプロファイルに分けて保存しています。",
  },
];

/**
 * 自宅基盤の構成を層ごとに要約したもの。IP アドレス・機種名・監視系は載せない。
 */
export const homelabLayers = [
  { layer: "公開経路", items: ["Cloudflare Tunnel"] },
  { layer: "プロキシ / DNS", items: ["Nginx Proxy Manager", "AdGuard Home"] },
  { layer: "アプリ", items: ["koshikai.dev", "Smoke it.", "KariGallery", "Nextcloud"] },
  { layer: "データ", items: ["PostgreSQL", "Immich（写真・動画）"] },
  { layer: "オフロード", items: ["機械学習処理 → GPU マシン"] },
  { layer: "基盤", items: ["Proxmox VE", "LXC", "Docker"] },
];

/** このサイトのデプロイ経路。.github/workflows/deploy.yml と一致させる */
export const pipelineSteps = [
  {
    label: "git push",
    detail: "main",
    summary: "docs/** と *.md 以外の変更を main ブランチへ push すると、Build and Deploy ワークフローが起動します。",
    spec: "branches: [main] / concurrency: cancel-in-progress",
  },
  {
    label: "GitHub Actions",
    detail: "typecheck · lint · test · audit",
    summary: "ubuntu-latest 上の Bun 1.3.13 で lint・型チェック・Vitest を実行し、lockfile 変更時は bun audit で依存を検査します。",
    spec: "bun run lint && bun run typecheck && bun run test --run",
  },
  {
    label: "Docker build",
    detail: "multi-stage",
    summary: "Docker Buildx と GitHub Actions キャッシュを使い、Node.js 22 ベースの本番用マルチステージイメージをビルドします。",
    spec: "docker/build-push-action@v6 (cache-from: type=gha)",
  },
  {
    label: "GHCR",
    detail: "image registry",
    summary: "ビルド済みイメージにコミット SHA と latest のタグを付けて GitHub Container Registry へプッシュします。",
    spec: "ghcr.io/koshikai/portfolio-app",
  },
  {
    label: "self-hosted runner",
    detail: "自宅 Proxmox",
    summary: "自宅 Proxmox 上で稼働する self-hosted runner がデプロイジョブを受け取り、compose 定義と環境変数を同期します。",
    spec: "runs-on: self-hosted -> ~/deploy/portfolio",
  },
  {
    label: "Docker Compose",
    detail: "pull · up -d",
    summary: "最新イメージを pull し、docker compose up -d --remove-orphans でコンテナを入れ替えます。24 時間超の古いイメージも自動整理します。",
    spec: "docker compose -p portfolio pull && up -d",
  },
  {
    label: "/healthz",
    detail: "healthcheck",
    summary: "稼働中の SSR サーバーが GET /healthz に対して JSON（{\"ok\":true}）を返し、疎通できる状態を保ちます。",
    spec: "GET /healthz -> 200 OK",
    isHealthcheck: true,
  },
];

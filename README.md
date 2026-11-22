# koshikai.dev

作品、個人開発の運用、研究を紹介するポートフォリオです。TanStack Start、TypeScript、Tailwind CSS v4 で構築しています。公開サイトは [koshikai.dev](https://koshikai.dev) です。

## ローカル開発

Bun 1.0 以上が必要です。ローカルでの起動とビルドにデータベース接続は不要です。

```bash
bun install
bun run dev
```

## 環境変数

メタデータ、canonical URL、サイトマップのベース URL は `SITE_URL` で指定できます。既定値は `https://koshikai.dev` です。ローカルの URL を指定する場合は、[`.env.example`](./.env.example) を `.env.local` にコピーして編集してください。

## リポジトリ構成

- `src/routes/` に TanStack Router のルートを置いています。ケーススタディの個別ページは `src/routes/cases/$slug.tsx` です。
- `src/components/` にサイトの共通コンポーネント、`src/lib/` に作品や研究などの表示データを置いています。
- `src/content/cases/` に MDX のケーススタディ本文、`public/images/` に図版とスクリーンショットを置いています。
- `server.mjs` が本番環境でサイトを配信します。ヘルスチェックは `/healthz` です。

全体構成は [`docs/architecture.md`](./docs/architecture.md) を参照してください。

## 検証

```bash
bun run lint
bun run typecheck
bun run test -- --run
bun run build
bun audit
```

## デプロイ

`main` への push で GitHub Actions が検証を行い、Docker イメージを GitHub Container Registry（GHCR）に push します。その後、Proxmox 上の self-hosted runner が Docker Compose でサイトを更新します。Markdown と `docs/` 配下だけの変更ではデプロイは起動しません。

デプロイ構成とトラブルシューティングは [`docs/deployment.md`](./docs/deployment.md) を参照してください。

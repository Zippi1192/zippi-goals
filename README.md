# 2026 GOALS v0.3.0

GitHub Pages に公開するための **公開用ファイルだけ** が入っています。このフォルダには個人の目標、実績、作品名などの初期データは入っていません。

## GitHub Pages への配置

1. GitHub でリポジトリを作成します。
2. このフォルダ内のファイルだけをリポジトリのルートへ置きます。
3. GitHub の Settings > Pages で、main ブランチの root を公開元に設定します。
4. 発行された `https://<user>.github.io/<repo>/` を iPhone の通常 Safari で開きます。
5. Safari の共有メニューから「ホーム画面に追加」します。
6. 以後はホーム画面の `2026 GOALS` から起動します。
7. 初回起動時に `PRIVATE_2026-goals-initial-data-v0.3.json` を読み込みます。

**PRIVATE で始まる初期データJSONや、backup を含むJSONは GitHub にアップロードしないでください。** iCloud Drive / iPhone の「ファイル」に保管してください。

## 保存場所

- 記録ログ、日次データ、月次メモ、目標設定: iPhone/PWA 内の IndexedDB
- 最終バックアップ日時などの小さな設定: Local Storage
- GitHub Pages: アプリ本体のみ。個人記録は送信しません。

## バックアップ

設定画面の「バックアップ保存」を押すと JSON を作ります。iPhone では共有シートから「ファイルに保存」を選び、iCloud Drive に保存してください。

復旧時は、PWA の設定画面で「バックアップ復元」を押して、保存した JSON を選びます。新しい iPhone の場合も、GitHub Pages から PWA をホーム画面へ追加したあと、同じ方法で復元できます。

30日バックアップがないと通知、60日で強めの通知を表示します。

## アプリ更新

GitHub Pages のファイルを更新すると、新しい Service Worker が待機状態になります。PWA 内に更新通知が出ます。

「バックアップして更新」を選ぶと、バックアップ保存後に新バージョンを有効化して再読み込みします。同じ GitHub Pages の URL / scope / IndexedDB 名を使い続ける限り、iPhone 内の記録はそのままです。

データ構造の変更は IndexedDB の `DB_VERSION` と `onupgradeneeded` で将来のマイグレーションを追加できる土台にしています。

## v0.2 からの移行

同じ PWA / 同じオリジンに v0.2 の Local Storage データが残っている場合、初期データを読み込んだあと、追加ログを IndexedDB へ移行する案内が出ます。基準値は重複させず、日次・イベント・月次メモなどだけを取り込みます。

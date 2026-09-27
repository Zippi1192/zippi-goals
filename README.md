# 2026 GOALS PWA v0.3.2

個人データをiPhone内のIndexedDBに保存するローカルファーストPWAです。GitHub Pagesにはこの公開用ファイル一式だけを置き、PRIVATEの初期データ / バックアップJSONはアップロードしません。

## v0.3.2 の主な機能
- TODAYの日次チェック
- CALENDARから過去日を修正
- 映画 / ゲーム / 脱出 / 友達等のイベントログ
- 目標ごとのBONUS CHALLENGE。自由に追加・チェック可能
- checklist / status型の目標
- 「〇月まで」の20目標テキスト出力・コピー
- Instagram Story向け1080x1920画像の生成 / 共有 / PNG保存
- 月末スナップショット保存
- IndexedDBバックアップ / 復元
- Service WorkerによるPWA更新通知
- PRIVATE設定パッチの読み込み。アプリ更新時も日次 / イベントログを残して目標設定だけ差し替え可能

## GitHub Pages
`main` / `/(root)` を公開してください。`index.html` がリポジトリ直下にある状態が正解です。

## PRIVATE JSON
初期データ / 移行データ / バックアップJSONはGitHubに置かず、iPhoneまたはiCloud Driveだけに保存してください。

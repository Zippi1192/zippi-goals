# Changelog

## v0.3.0

- 記録ログ本体を Local Storage から IndexedDB へ移行する土台を追加
- IndexedDB の DB_VERSION / onupgradeneeded による将来マイグレーション基盤を追加
- Local Storage は最終バックアップ日時など小さな設定だけに使用
- 公開PWAから個人の目標・基準値・作品リストを分離
- 初回に PRIVATE 初期データJSONをiPhoneへ読み込む方式へ変更
- JSONバックアップ保存 / 復元
- 30日・60日のバックアップアラート
- 月次画面からもバックアップ通知
- Service Workerの待機更新を検知し、PWA内に更新通知を表示
- 「バックアップして更新」でバックアップ後に新バージョンを有効化
- 同じURL / scope / IndexedDB名を維持してアプリ本体を更新しても記録を保持
- 同一オリジンにv0.2 Local Storageが残っていれば追加ログをIndexedDBへ移行可能

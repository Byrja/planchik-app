# Изолированная проверка и откат

Production в этой работе не разворачивается. Рабочая ветка: `ux/reaudit-2026-10-25`.
Исходный frontend SHA: `4ba1b44268ba7f3cd0aa9c8fa41418a78df7cba0`.
Backend для локальной регрессии: `203dc0b6a0d70b0240ebe8c52c28725e0b3e77d0`; backend не изменялся.

## Локальный UI

```sh
npm ci
npx playwright install chromium
npm test
npm run check
PW_PORT=4193 npm run test:e2e
python3 -m http.server 4180 --bind 127.0.0.1
```

Открыть http://127.0.0.1:4180/. Это статический UI, не настоящая Telegram-интеграция; обычный Python HTTP server не исполняет Cloudflare `_worker.js`. E2E подставляет ответы API и Telegram окружение. Не вводить реальные initData в URL или логи.

## Staging (требует отдельного развёртывания и тестовых credentials)

1. Создать отдельный preview frontend и изолированный backend с новой тестовой SQLite DB; production DB и `.env` не копировать. Использовать отдельного Telegram test bot. Рабочую ветку не сливать в автоматически публикуемую production-ветку.
2. Проверить маршрутизацию API: `_worker.js` имеет фиксированный upstream — preview нельзя оставлять подключённым к production API. Для staging подготовить отдельную конфигурацию worker/backend, CORS allowlist и Telegram WebApp URL. Не ослаблять HMAC-валидацию для тестов.
3. Проверить валидное initData обычного пользователя и владельца тестового backend. Owner определяется сервером по валидированному Telegram ID; флаг в браузере не является доказательством owner bypass.
4. На 320×700, 360×800, 390×844 пройти все вкладки, аватар, карту/совместимость из разных мест, Close, Telegram BackButton, повторное открытие, сохранность данных формы, быстрые переходы при загрузке Arc и повтор после ошибки загрузки.
5. Проверить историю empty/loading/error/401/403/retry, новый сохранённый результат после возврата из Карт, дневник. Проверить реальную клавиатуру и safe-area в Telegram iOS/Android — headless Chromium не заменяет эту проверку.
6. В тестовой DB зафиксировать owner balance=0, строки mana ledger и AI usage, вызвать функции и проверить отсутствие списания/usage и сохранение истории. Отдельно обычный user: 402 при недостатке маны и соблюдение лимитов. Не проводить реальные платежи; Stars только через изолированные fixtures/официальную тестовую среду.
7. До коммерческого выпуска отдельно подтвердить полный auth/payment/AI/history/analytics end-to-end. Локальные тесты и mocks этого не доказывают.

## Rollback

Изменения касаются frontend; миграций БД нет. Перед staging сохранить SHA/артефакт предыдущего preview и его конфигурацию. Для возврата опубликовать именно предыдущий preview artifact или собрать исходный SHA в отдельном каталоге:

```sh
git worktree add --detach ../gadalka-ux-baseline 4ba1b44268ba7f3cd0aa9c8fa41418a78df7cba0
```

Не выполнять `git reset --hard` в live workdir и не удалять данные пользователей. После отката проверить версии HTML/JS/CSS и закрытие вложенных экранов; исходная версия содержит известные UX-дефекты, поэтому rollback не означает UX-приёмку. Production не менялся, production rollback в рамках этой задачи не нужен.

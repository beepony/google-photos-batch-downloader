# Contributing

Thanks for helping! / 欢迎参与！

- **Bugs:** open an issue with your Chrome version, the UI language of the Takeout page and what you saw.
  Please don't paste full Takeout URLs — they contain your account ID and a sign-in token.
  提交问题时请不要粘贴完整的 Takeout 链接，里面包含账号 ID 和验证令牌。
- **Code:** no build step. Edit files in `extension/`, then run:

  ```bash
  node --test tests/*.test.mjs
  node harness/e2e.mjs
  ```

- **Translations:** every UI string is in `extension/src/i18n.js`. Add a language by adding a table with the
  same keys; `tests/i18n.test.mjs` checks keys and placeholders. Also add `extension/_locales/<lang>/messages.json`.

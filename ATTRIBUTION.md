# Ресурсы проекта

- **Three.js r170** — [официальный репозиторий](https://github.com/mrdoob/three.js/tree/r170), лицензия MIT. Полный текст сохранён в `dist/vendor/THREE-LICENSE.txt`.
- **Звуки мемов** — локальные MP3 из [IDE-Error-Soundboard, каталог sounds](https://github.com/PareekshithPalat/IDE-Error-Soundboard/tree/main/sounds): `bruh.mp3`, `vine-boom.mp3`, `among-us-role.mp3`, `metal-pipe-clang.mp3`, `anime-wow.mp3`, `spongebob-fail.mp3`. [Скрипт источника](https://github.com/PareekshithPalat/IDE-Error-Soundboard/blob/main/scripts/download_sounds.js) содержит ссылки на исходные загрузки Myinstants. Лицензия кода стороннего репозитория не считается лицензией на записи мемов.
- **Картинка Спанч Боба** — [шаблон Mocking Spongebob на Imgflip](https://imgflip.com/memetemplate/102156234/Mocking-Spongebob), изображение `https://i.imgflip.com/1otk96.jpg`. Персонаж SpongeBob SquarePants принадлежит Nickelodeon / Paramount.
- **Картинка Скалы** — [поднятая бровь Dwayne Johnson на Meme-Arsenal](https://www.meme-arsenal.com/en/create/chose?tag=Dwayne+Johnson+meme), изображение `https://images.meme-arsenal.com/d0e5e24e4ab1fc3ac9be46a5f6ae5ad8.jpg`.
- **SVG Bruh, Among Us, труба, Anime Wow, favicon** — нарисованы кодом для проекта; находятся в `scripts/download-assets.mjs`. Among Us — персонаж, вдохновлённый игрой Innersloth.
- **Модель персонажа, комната, освещение, эффекты верного и неверного ответа** — созданы кодом для проекта; внешние модели и шрифты не используются.

Игра загружает все игровые ресурсы со своего хостинга. Сторонние сервисы не получают запросы во время игры. Скрипт восстановления ресурсов обращается к источникам только при ручном запуске.

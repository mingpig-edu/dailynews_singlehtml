每日主題情報 BYOK v0.3.0
============================

使用方法
1. 把 index.html 放到 GitHub Pages 或其他 HTTPS 靜態網站，亦可嘗試直接在瀏覽器開啟。
2. 第一次使用：輸入自己的 Gemini API Key（可選擇記住在此瀏覽器）。
3. 輸入新聞主題，按「切換主題並產生今天新聞」。
4. 之後每天第一次打開頁面時，若今天尚未有「目前主題」的日報，系統會自動生成一次。
5. 更改主題不會刪除舊日報；同一天不同主題亦可並存。
6. 歷史資料保存在瀏覽器 IndexedDB。請用「匯出歷史 JSON」備份；備份不包含 API Key。

資料來源
- GDELT DOC 2.0：搜尋近期新聞候選。
- Gemini API：可選，用來挑選最多 10 則、翻譯／整理標題及做保守摘要。
- 不使用 Google Search grounding。

API Key 注意
- index.html 本身沒有 API Key。
- 若選「記住在此瀏覽器」，Key 會存於該網站在瀏覽器的 localStorage。
- 不要在公共或共用電腦儲存 Key。
- 此為個人 BYOK 工具；Google 官方對 production client-side app 的最佳做法仍是用後端保存 API Key。

版本：0.3.0

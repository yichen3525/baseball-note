# Baseball Note

中華職棒個人看球紀錄。到球場打卡，選好日期和球場就會自動帶入對戰球隊、比分、先發投手、勝敗投與 MVP，每場比賽存成一張球票。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `index.html` | 網站本體 |
| `data/games.json` | 中職比賽資料，每天自動更新 |
| `scripts/update-games.mjs` | 抓比賽資料的程式 |
| `.github/workflows/update-games.yml` | 每天自動執行上面的程式，並部署網站 |

## 第一次設定

1. 把這些檔案上傳到 GitHub repo（公開）。
2. 到 **Settings → Pages**，Source 選 **GitHub Actions**。
3. 到 **Actions**，選「更新比賽資料並部署網站」，按 **Run workflow** 跑第一次。
4. 完成後網址是 `https://你的帳號.github.io/repo 名稱/`。

之後每天台灣時間 22:40、00:20、11:10 會自動更新比賽資料。

## 比賽資料來源

1. 中職官網 cpbl.com.tw：資料最完整，但官網會擋 GitHub 的雲端主機，通常只有在台灣的家用或手機網路才連得上。
2. 野球革命 Rebas（rebas.tw）：官網連不上時自動改用，有比分與場次，沒有勝敗投和 MVP。

想補上最新的勝敗投與 MVP，可以在家裡的電腦執行一次 `node scripts/update-games.mjs`，再把 `data/games.json` 上傳回 repo。

個人看球紀錄只存在自己的瀏覽器裡，不會上傳到 GitHub。換手機前請在網站的「設定」匯出備份檔。

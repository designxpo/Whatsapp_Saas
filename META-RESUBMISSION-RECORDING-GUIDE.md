# Meta resubmission: recording guide (Talko.AI, app 2543832302713267)

Written 2026-10-29. Every statement is tagged: VERIFIED (read from your screenshot or our code) or UNVERIFIED (I cannot see it; you must check).

## 1. What is missing

VERIFIED from your App Review screenshot (status "Not approved"):

| Permission | What our code does with it |
|---|---|
| `pages_read_user_content` | Needed for Facebook Page comments to be delivered to us (channels.ts:787-800, embeddedsignup.ts:135). Comment text arrives in the webhook. |
| `pages_manage_engagement` | Posts the public reply (`POST /{comment-id}/comments`, messenger.ts:251) and likes the comment (`POST /{comment-id}/likes`, messenger.ts:270). |
| `ads_read` | Reads campaigns, ad sets, ads and their insights (spend, clicks, CTR) for the Ads tab (ads.ts:257-367). |

VERIFIED, approved already (do not resubmit): instagram_business_basic, instagram_business_manage_messages, pages_show_list, pages_manage_metadata, pages_messaging, pages_read_engagement, public_profile, whatsapp_business_messaging, whatsapp_business_management, leads_retrieval, ads_management.

UNVERIFIED (check these yourself before recording, 5 minutes):
1. `instagram_business_manage_comments` is NOT in the list on your screenshot. It may be approved under Use cases > Instagram, or it may have been dropped. Open App Review > Permissions and features, search the name. If it says "Advanced access" with a green tick, skip Video C. If it is missing or "Standard access", record Video C.
2. The Human Agent feature (App Review > Features). Our code sends `HUMAN_AGENT` message tags (my August note). Search it on the same page. If not approved, request it with the Instagram recording.
3. The rejection reason for each of the three. Click "View request details" and read the latest reason. Paste it to me. If it still says "screencast not aligned with use case details", the recording is the fix. If it says something new, tell me before you record anything.

## 2. Pre-flight (do before pressing record)

1. Use a clean browser window (no other tabs, no bookmarks bar, English UI). Set Chrome language to English.
2. Record at 1080p or higher, with a mic or on-screen captions in English (Meta requirement). I recommend captions as text overlays on each step.
3. Log in to https://app.thetalko.in with the OWNER account. Comment automation shows only for the platform owner on the default workspace (SettingsTab.tsx:1551, InstagramTab.tsx:132). Any other login shows "coming soon", so do not record from a tenant account.
4. Give Meta reviewers the same owner credentials in the submission notes (the login skips the new-device OTP only if their email is in `LOGIN_OTP_EXEMPT_EMAILS` in Vercel; add it and redeploy first).
5. Your Gemini AI key must have quota. Earlier it returned 429 and AI replies fell back. Comment rules with fixed replies don't need AI, so use rule replies in these videos. Fixed replies avoid any AI failure on camera.
6. Have a SECOND Facebook account ready (not an admin of the Page) to post the comment. The automation never replies to the Page's own comments.
7. Remove old grants first: Facebook > Settings > Business integrations > Talko.AI > Remove. A second login would otherwise skip the permission screen, and Meta must SEE the grant.
8. Only comments posted AFTER the rule is saved fire, and each comment is answered once. Post a fresh comment per take.

## 3. Video A: Facebook comments (covers pages_read_user_content and pages_manage_engagement)

Record as one continuous take, about 4 minutes.

1. Show the Talko.AI portal login page, log in as the owner. Say or caption: "I am the admin of a business using Talko.AI to manage its Facebook Page."
2. Click Facebook in the left sidebar. Show the "Facebook Messenger" card.
3. Click **Connect with Facebook**. The Meta dialog opens. Keep the dialog on screen for at least 5 seconds. REQUIRED: the screen that lists the permissions must be fully visible, including "Manage and access Page conversations on Messenger", "Manage comments on your Page" and "Read content posted on the Page" (pages_manage_engagement and pages_read_user_content). Scroll the dialog so each line is readable.
4. On "Choose the Pages you want Talko.AI to access", tick the Page. Click Continue and finish. Pause on the confirmation.
5. Back in Talko, show the connected Page in the Facebook tab.
6. Scroll to **Comment reply automation** (public reply, no DM). Click **New reply rule**. Pick the Page, choose "All posts" or one post, type a keyword (for example "price"), write 2 reply variants, tick **Like the comment too**, click Save. Show the saved rule in the list.
7. Open a second browser window (the non-admin Facebook account), open the Page's post, and write a comment containing the keyword. Show the comment text and the account name on screen.
8. Return to the Facebook Page post, refresh, and show the Page's public reply under that comment, and the like. This is the proof of pages_manage_engagement (reply + like).
9. Return to Talko, open the Facebook tab, show the rule's match count increased by 1.
10. Click **New rule** under **Comment-to-DM automation**, set a keyword, DM text and a button, save. Post another comment with that keyword from the second account. Show the commenter's Messenger inbox receiving the private DM. Then open Live Chat in Talko and show the same conversation.
11. Say or caption at the end: "Comment text arrives through the Page webhook (pages_read_user_content). The Page replies and likes through the Graph API (pages_manage_engagement)."

## 4. Video B: Meta Ads (ads_read)

About 3 minutes.

1. In Talko, click Meta Ads in the sidebar. Caption: "The business owner connects their ad account to see campaign performance."
2. Click **Connect with Meta**. Show the whole Meta dialog, including the permissions screen listing ad account access (ads_read and ads_management). Choose the ad account and finish.
3. Back in the Ads tab, show the connected account name, currency and status.
4. Show the campaigns table with spend, impressions, clicks, CTR for a date range. Switch the date range once so Meta sees it is live data. Open one campaign to show ad sets and ads with their numbers.
5. Caption: "ads_read is used only to read campaign, ad set and ad performance. We never display other people's data."
6. IMPORTANT: use an ad account with real spend so the numbers are non-zero.

## 5. Video C: Instagram comments (only if check 1 says it is needed)

About 3 minutes.

1. Click Instagram in the sidebar. Click **Connect Instagram**. This opens instagram.com's own login (not Facebook). Keep the permission screen on screen and readable, showing message access and comment access.
2. Finish. Show the connected account in the Instagram tab.
3. Click **New rule** (comment-to-DM) or **New reply rule** (public reply). Set a keyword, reply text, save.
4. From another Instagram account, comment on a post with the keyword. Show the comment.
5. Show the public reply and/or the private DM landing, and the match count in Talko.

## 6. What I will check after you send the files

I will extract frames from your video(s) with ffmpeg and read them. I cannot hear audio (no speech tool is installed), so rely on on-screen captions for anything you narrate. I will check each item against these tags:

A1 login as owner visible. A2 Facebook tab shown. A3 Meta dialog: all permission lines readable for at least 5 seconds. A4 Page tick screen. A5 connected Page. A6 reply rule saved with like ticked. A7 second-account comment with keyword visible. A8 public reply AND like visible on the Facebook post. A9 match count in Talko. A10 comment-to-DM rule, DM received in Messenger, same chat in Live Chat.
B1 Connect with Meta, permission dialog readable. B2 ad account chosen. B3 connected account shown. B4 non-zero campaign data, date range change, ad set/ad drill-down.
C1 to C5 as listed, only if needed.

Anything I cannot see I will mark "not shown" rather than assume.

## 7. Meta's actual feedback (read from your screenshots, 2026-10-29)

Latest submission (id 2544156549347509): `pages_read_user_content`, `pages_manage_engagement` and `ads_read` are all rejected with the SAME reason: "Screencast Not Aligned with Use Case Details". Meta says "your apps' use case is allowed", and the screencast "fails to demonstrate the end-to-end experience". It asks for five things in the new screencast:

1. The complete Meta login flow.
2. A user granting app access to the permission.
3. The end-to-end experience of the use case for that permission.
4. English UI, captions AND tool-tips, and an explanation of what buttons and other UI elements mean.
5. If the app is server-to-server or uses a system user token, say so in the submission. (Our connect flows use the user's own login, not a system user token, so write: "Not server-to-server. Users log in through the Meta login dialog shown in the video.")

Older submission (id 2563090414120789, 15 Aug 2026): `pages_read_user_content` was rejected as "Disallowed Use Case Details" (use case invalid or not needed for core functionality). Meta's later feedback says the use case is allowed, so that is superseded. But the submission notes for this permission must answer Meta's three questions, so write them:

- Which functionality needs it: Facebook comment automation (comment-to-DM and public comment replies).
- How it works: Facebook delivers a Page comment's text to our webhook; we match the business's keyword rule and respond.
- How it helps the end user: the business answers every customer comment within seconds, and the customer gets a private message with the link or answer they asked for.

HONEST LIMIT: our code never calls a "read comments" endpoint. Comment text arrives in the webhook only (channels.ts:787-800). Do NOT write that we "fetch" or "list" comments. Write "receive". The notes must match the video, and the video must show a comment arriving and the rule firing.

Extra recording requirements from item 4: add text captions to every step, and use a visible highlight or a short on-screen label for each button you click (for example "Connect with Facebook: starts the Meta login"). Narrate or caption the meaning of each permission line in the Meta dialog.

One thing I noticed and cannot explain: the "Request again" button on both feedback pages looks faded (disabled). If it stays disabled, start a new request instead: App Review > Permissions and features > search the permission > Request advanced access, then upload the new video there. Check that before you record, so you know where the video goes.

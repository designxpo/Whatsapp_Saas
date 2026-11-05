# Talko AI — two-month social campaign

**November 5, 2026–January 4, 2027 · one main post every other day · 31 posts · 93 platform captions**

The campaign is prepared for LinkedIn, Instagram and Facebook. It contains finished artwork and copy, with a proposed release calendar. The files do not publish to or queue content in any social account.

## Open the campaign

Open [index.html](index.html) in a browser to inspect every post and expand its platform captions. Each card links to its finished image.

| File or folder | Use |
| --- | --- |
| `images/` | 31 finished JPEGs, each 1080 × 1350, suitable as a portrait feed creative. |
| `posts/` | One readable file per post, containing all three captions, keywords, alt text and links. |
| `calendar.csv` | One row per main post: date, theme, audience, asset and platform times. |
| `publishing.csv` | 93 rows: one complete caption and asset reference per platform publication. |
| `daily-actions.csv` | All 61 calendar days, including engagement tasks between main posts. |
| `results.csv` | Blank measurement template; fill with observed results, never estimates presented as actuals. |
| `campaign.json` | The same campaign in a structured format for a future importer. |

The CSV is a master export, not a claim of compatibility with every scheduler's import format. Map its fields to the scheduler you actually use. All times are supplied in UTC and IST; set the account scheduler timezone before uploading a batch.

## Cadence and topic structure

The selected cadence gives the team time to answer questions and review the previous post before publishing the next one. It is an operating choice for this campaign, not a universal algorithm rule.

| Cadence over this 61-day window | Main posts | Operating trade-off |
| --- | ---: | --- |
| Daily | 61 | Requires a larger creative and response workload. Not the selected plan. |
| Every other day | 31 | Selected: a complete main post, then an engagement day. |
| Every three days | 21 | A slower alternative if the team cannot maintain the selected response workload. |

The sequence moves from platform understanding and practical workflows into Black Friday preparation, December customer experience and January planning. It mixes product walkthroughs, buying questions, creator workflows, reviews, commerce, team ownership and onboarding. The same main concept is adapted for three platforms; the captions are not identical copies.

On the days between main posts:

1. Reply to genuine comments and useful customer questions.
2. Share the last post to an Instagram Story when relevant, using its post-specific link sticker target.
3. Record recurring questions and actual enquiries. Do not collect unnecessary personal details in public comments.
4. Check whether the destination page, product facts and offer remain current.
5. Review the next asset and who will handle any enquiries it generates.

No new main creative is required on these engagement days.

## Suggested times: test, then adjust

Two timing cohorts are included to learn about the audience. They are starting points, not guaranteed best times. Topics and dates differ, so treat the comparison as directional evidence rather than a controlled causal experiment.

| Platform | Cohort A, IST / UTC | Cohort B, IST / UTC |
| --- | --- | --- |
| LinkedIn | 7:30 PM / 14:00 | 2:30 PM / 09:00 |
| Facebook | 7:00 PM / 13:30 | 6:00 PM / 12:30 |
| Instagram | 8:00 PM / 14:30 | 7:00 PM / 13:30 |

Cohort A overlaps an Indian evening with a North American morning. The earlier LinkedIn cohort gives India/European daytime another opportunity. Publish dates stay on the alternate-day cadence, including weekends; do not compare a weekend result with a weekday without noting the difference.

After two weeks, inspect relevant website sessions, useful enquiries and response workload alongside reach and engagement. Adjust future slots using the account's actual audience data. If today's first slot has passed when you start using this folder, publish it at the next staffed opportunity or move the batch forward; the files themselves are not a live queue.

LinkedIn's own guidance recommends testing timing against your audience and working toward a consistent posting routine. This pilot deliberately uses alternate-day main posts so a small team can maintain both useful content and responses. [LinkedIn timing guidance](https://www.linkedin.com/business/marketing/blog/linkedin-ads/whats-the-best-time-to-post-on-linkedin), [LinkedIn Page posting guide](https://business.linkedin.com/content/dam/lem/business/en/advertise/linkedin-pages/lms-linkedin-page-posting-best-practices-one-pager.pdf).

## Publish on LinkedIn

1. Open the authorised company Page and start a post.
2. Upload the matching JPEG from `images/`; do not copy a thumbnail from the gallery.
3. Paste that post's LinkedIn caption and add its alt text through the available image controls.
4. Verify the destination URL and the current product workflow. The link already includes the campaign and post identifiers.
5. Use the Page's available scheduler, verify its timezone and confirm the date in the queue.
6. Return near publication time to respond to relevant comments and enquiries.

The LinkedIn copy explains the business problem, gives a short operating checklist and asks a relevant question. Keep that context if shortening a post. Three descriptive hashtags are supplied; adding many unrelated tags is not part of the plan.

## Publish on Instagram

Use the Instagram-specific caption and portrait JPEG on the authorised professional account. Keep the opening hook, workflow steps and the relevant question; the five supplied hashtags describe the topic rather than promising reach.

Feed-caption URLs are not assumed to be clickable. Each post file therefore contains:

- A stable, campaign-tagged profile/bio URL. This attributes profile traffic to the campaign, not to an individual feed post.
- A post-specific Story URL for a link sticker or a relevant link-hub item. This is the better path when you need post-level click attribution.

Do not claim that a bio visit proves which feed post produced it. On a main-post day, a useful companion Story is the finished creative plus one relevant question and its matching link sticker. On the next day, answer a real audience question or reshare a useful reply with permission.

## Publish on Facebook

Use the Facebook caption and matching JPEG on the correct business Page. Its direct link includes the platform and post identifier. Keep personal customer details out of public comments and direct an individual support case to the appropriate private channel.

Meta Business Suite can be used to prepare Facebook and Instagram content from the business tools available to the account. Check the selected Page/account, permissions, available scheduling horizon and timezone in the current interface. Do not assume an account can accept the entire two-month queue in one upload. A practical approach is rolling two-week batches, verified in the planner. [Meta for Business scheduling walkthrough](https://www.youtube.com/watch?v=PQjvbXyMhkM).

## Measure business progress

Use `results.csv` to record actual observations for each platform post. Review these stages separately:

1. Reach and engagement: impressions, meaningful comments, saves and shares where the platform provides them.
2. Website interest: tagged sessions and relevant page visits in your existing analytics setup.
3. Commercial intent: sales enquiries and signups where your instrumentation can establish them.
4. Business outcomes: qualified opportunities or completed actions confirmed by the team.

Tracking parameters identify traffic sources; they do not create missing conversion instrumentation or prove incrementality. The campaign uses `utm_source`, `utm_medium`, `utm_campaign` and `utm_content`. LinkedIn and Facebook direct links use `organic_social`; Instagram Story links use `organic_story`. [Google Analytics: campaigns and traffic sources](https://support.google.com/analytics/answer/11242841).

Do not infer a sale from a click, or claim an automation revenue lift from seasonal demand. Avoid entering customer names, phone numbers or private conversations into the public campaign files.

## Visual system and website relationship

The website uses a shared `CharacterStory` component backed by `src/app/(site)/_content/character-stories.ts`. It adds illustrations and selectable workflow steps inside existing sections. It keeps navigation, headings, existing workflow controls and the section sequence in place. Motion pauses when the scene is off screen or the tab is hidden, offers a pause button and respects reduced-motion preferences.

The 12 new website scenes live under `public/marketing/stories/`. They share a recurring male/female character family, warm light, tactile objects, off-white backgrounds and cobalt/violet accents. Existing article-specific artwork under `public/blog/` extends the same family. The social campaign uses a distinct illustration for every main post and adds its headline and workflow outside the scene, rather than covering the characters with text.

The new homepage sharing image is the native `src/app/(site)/opengraph-image.png` metadata asset. It is an illustration-only card; individual blog articles retain their own share images. Old shares can remain cached by a social platform, even after a fresh page fetch returns the new metadata.

These people are fictional illustrative characters, not real employees, customers or testimonials. Screens and symbols illustrate a workflow, not measured customer results. Do not label the images as customer case studies.

## Product and editorial checks

- Promote current, demonstrable workflows. This campaign does not advertise the proposed live voice-calling system as available.
- Keep channel eligibility, plan availability, configured provider keys and required integrations in mind when answering enquiries.
- Confirm prices from the live pricing page rather than adding an old fixed price to an image.
- Keep messaging permission, review neutrality and a human exception path intact.
- If a current feature changes, update the matching caption, image workflow and destination before publishing it.

Only finished campaign deliverables belong in this folder. Raw generations, contact sheets, browser recordings, build logs and export scripts are intentionally excluded.

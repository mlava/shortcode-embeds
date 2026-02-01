let toastCleanup = null;
let toastHideTimer = null;

export default {
    onload: ({ extensionAPI }) => {
        extensionAPI.ui.commandPalette.addCommand({
            label: "Paste Embed from clipboard",
            callback: () => embedClip({ mode: "auto" }),
        });

        extensionAPI.ui.commandPalette.addCommand({
            label: "Paste Embed from clipboard (as link)",
            callback: () => embedClip({ mode: "link" }),
        });

        extensionAPI.ui.commandPalette.addCommand({
            label: "Paste Embed from clipboard (as iframe)",
            callback: () => embedClip({ mode: "iframe" }),
        });

        async function embedClip({ mode = "auto" } = {}) {
            if (!isRoamApiAvailable()) {
                toast("Roam API not available yet. Try again after Roam finishes loading.");
                return;
            }

            let raw = "";
            try {
                raw = (await navigator.clipboard.readText()) ?? "";
            } catch (err) {
                console.warn("[Shortcode Embed] Clipboard read failed", err);
                toast("Could not read clipboard. Check browser permissions.");
                return;
            }
            const clipText = raw.trim();

            const focusedUid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
            if (!focusedUid) {
                alert("Please place your cursor in a block to embed in your graph");
                return;
            }

            // Mermaid: clipboard is code, not URL
            const mermaidLines = extractMermaid(clipText);
            if (mermaidLines) {
                await window.roamAlphaAPI.updateBlock({
                    block: { uid: focusedUid, string: "{{mermaid}}", open: false },
                });
                for (const line of mermaidLines) {
                    if (!line.trim()) continue;
                    await window.roamAlphaAPI.createBlock({
                        location: { "parent-uid": focusedUid, order: "last" },
                        block: { string: line },
                    });
                }
                toast("Inserted Mermaid code block.");
                await createSiblingAndFocus(focusedUid);
                return;
            }

            const excalidraw = parseExcalidraw(clipText);
            if (excalidraw) {
                await importExcalidrawToRoam({
                    targetUid: focusedUid,
                    excalidraw,
                    roamExcalidrawVersion: "0.18.0",
                });
                toast("Inserted Excalidraw embed.");
                await createSiblingAndFocus(focusedUid);
                return;
            }

            // Batch paste support
            if (!clipText) {
                toast("Clipboard is empty.");
                return;
            }

            let urls = extractUrls(clipText);
            if (!urls.length) {
                // If it's not a URL and not mermaid, keep the old behavior: warn + insert text
                toast("Clipboard did not contain a valid URL. Inserted as plain text.");
                await window.roamAlphaAPI.updateBlock({
                    block: { uid: focusedUid, string: clipText, open: true },
                });
                await createSiblingAndFocus(focusedUid);
                return;
            }

            const maxUrls = 20;
            if (urls.length > maxUrls) {
                toast(`Clipboard contained ${urls.length} URLs. Capped to first ${maxUrls}.`);
                urls = urls.slice(0, maxUrls);
            }

            // Single URL -> replace focused block
            if (urls.length === 1) {
                const url = normalizeUrl(urls[0]);
                const { embedString, note } = await buildEmbedString(url, mode);

                const finalString = embedString || `[${url}](${url})`;
                await window.roamAlphaAPI.updateBlock({
                    block: { uid: focusedUid, string: finalString, open: true },
                });

                toast(embedString ? (note || "Inserted embed.") : "Could not embed — inserted plain link.");
                await sleep(50);
                document.querySelector("body")?.click();
                await createSiblingAndFocus(focusedUid);
                return;
            }

            // Multiple URLs -> insert children under focused block
            await window.roamAlphaAPI.updateBlock({
                block: { uid: focusedUid, string: "Embedded Links", open: true },
            });
            for (const u of urls) {
                const url = normalizeUrl(u);
                const { embedString } = await buildEmbedString(url, mode);
                const finalString = embedString || `[${url}](${url})`;

                await window.roamAlphaAPI.createBlock({
                    location: { "parent-uid": focusedUid, order: "last" },
                    block: { string: finalString },
                });

                await sleep(10);
            }

            toast(`Inserted ${urls.length} item(s).`);
            document.querySelector("body")?.click();
            await createSiblingAndFocus(focusedUid);
        }

        async function buildEmbedString(url, mode) {
            if (mode === "link") return { embedString: `[${url}](${url})`, note: "Inserted as link." };
            if (mode === "iframe") return { embedString: `{{iframe: ${url}}}`, note: "Inserted as iframe." };

            // AUTO mode: specific -> general -> oEmbed -> website iframe
            const handlers = [
                tryYouTubePlaylist,
                tryYouTubeVideoOrShorts,
                tryReddit,
                tryWikipediaMobileIframe,
                tryGoogleDocsSheetsSlides,
                tryGoogleDriveFilePreview,
                tryLoom,
                tryVimeo,
                tryTikTok,
                tryInstagram,
                tryPinterest,
                trySoundCloudOEmbed,      // async
                tryGoogleMaps,
                tryTwitch,
                tryCodePen,
                tryJSFiddle,
                tryExcalidrawLink,
                tryGitHubNormalize,
                tryMedium,
                trySubstack,
                trySlideshare,            // best effort + benefits from oEmbed later
                tryFigmaOrFigJam,
                tryAudio,
                tryVideoFile,
                tryImage,
                tryGenericOEmbedNoembed,  // late-stage magic
                tryWebsiteIframe,         // final fallback
            ];

            for (let i = 0; i < handlers.length; i += 1) {
                const v = await handlers[i](url);
                if (v?.embedString) {
                    return v;
                }
            }

            return { embedString: null, note: null };
        }

        // -------------------- Handlers --------------------

        function tryYouTubeVideoOrShorts(url) {
            if (!/youtu\.?be|youtube\.com/i.test(url)) return null;

            const shortsMatch = url.match(/^https?:\/\/(www\.)?youtube\.com\/shorts\/([^?/#]+)/i);
            if (shortsMatch) {
                const id = shortsMatch[2];
                return { embedString: `{{youtube: https://www.youtube.com/watch?v=${id}}}`, note: "YouTube (shorts → watch) embed." };
            }

            const shortDomain = url.match(/^https?:\/\/youtu\.be\/([^?/#]+)/i);
            if (shortDomain) {
                const id = shortDomain[1];
                return { embedString: `{{youtube: https://www.youtube.com/watch?v=${id}}}`, note: "YouTube (youtu.be → watch) embed." };
            }

            return { embedString: `{{youtube: ${url}}}`, note: "YouTube embed." };
        }

        function tryYouTubePlaylist(url) {
            if (!/youtube\.com|youtu\.be/i.test(url)) return null;

            // playlist link: https://www.youtube.com/playlist?list=PL...
            // watch link with list: https://www.youtube.com/watch?v=...&list=PL...
            const listId = getUrlParam(url, "list");
            if (!listId) return null;

            // Use iframe videoseries embed
            const embed = `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(listId)}`;
            return { embedString: `{{iframe: ${embed}}}`, note: "YouTube playlist embed." };
        }

        function tryReddit(url) {
            if (!/^https?:\/\/(www\.)?reddit\.com\//i.test(url)) return null;

            // Convert reddit.com/r/{sub}/comments/{postId}/... to redditmedia embed
            // redditmedia supports embedding the whole thread view
            const m = url.match(/^https?:\/\/(www\.)?reddit\.com\/r\/([^/]+)\/comments\/([^/]+)\//i);
            if (!m) {
                // Also accept short /comments/{id} without /r/ (rare), fallback to iframe
                return { embedString: `{{iframe: ${url}}}`, note: "Reddit iframe (best-effort)." };
            }

            const sub = m[2];
            const postId = m[3];

            const embedUrl =
                `https://www.redditmedia.com/r/${encodeURIComponent(sub)}/comments/${encodeURIComponent(postId)}?ref_source=embed&ref=share&embed=true`;
            return { embedString: `{{iframe: ${embedUrl}}}`, note: "Reddit embed." };
        }

        function tryWikipediaMobileIframe(url) {
            if (!/wikipedia\.org/i.test(url)) return null;

            const m = url.match(/^https?:\/\/([a-z]{2,3})\.wikipedia\.org\/(.+)$/i);
            if (m) {
                const lang = m[1];
                const path = m[2];
                return { embedString: `{{iframe: https://${lang}.m.wikipedia.org/${path}}}`, note: "Wikipedia (mobile) iframe." };
            }
            return { embedString: `{{iframe: ${url}}}`, note: "Wikipedia iframe." };
        }

        function tryGoogleDocsSheetsSlides(url) {
            const doc = url.match(/^https?:\/\/docs\.google\.com\/document\/d\/([^/]+)/i);
            if (doc) return { embedString: `{{iframe: https://docs.google.com/document/d/${doc[1]}/preview}}`, note: "Google Doc preview." };

            const sheet = url.match(/^https?:\/\/docs\.google\.com\/spreadsheets\/d\/([^/]+)/i);
            if (sheet) return { embedString: `{{iframe: https://docs.google.com/spreadsheets/d/${sheet[1]}/preview}}`, note: "Google Sheet preview." };

            const slides = url.match(/^https?:\/\/docs\.google\.com\/presentation\/d\/([^/]+)/i);
            if (slides) return { embedString: `{{iframe: https://docs.google.com/presentation/d/${slides[1]}/preview}}`, note: "Google Slides preview." };

            return null;
        }

        function tryGoogleDriveFilePreview(url) {
            const m = url.match(/^https?:\/\/drive\.google\.com\/file\/d\/([^/]+)\//i);
            if (!m) return null;
            return { embedString: `{{iframe: https://drive.google.com/file/d/${m[1]}/preview}}`, note: "Google Drive file preview." };
        }

        function tryLoom(url) {
            const m = url.match(/^https?:\/\/(www\.)?loom\.com\/share\/([a-zA-Z0-9]+)(\?.*)?$/i);
            if (!m) return null;
            const id = m[2];
            return { embedString: `{{iframe: https://www.loom.com/embed/${id}}}`, note: "Loom embed." };
        }

        function tryVimeo(url) {
            if (!/^https?:\/\/(www\.)?vimeo\.com\//i.test(url)) return null;
            return { embedString: `{{[[video]]: ${url}}}`, note: "Vimeo embed." };
        }

        function tryTikTok(url) {
            const m = url.match(/^https?:\/\/(www\.)?tiktok\.com\/.*\/video\/(\d+)/i);
            if (!m) return null;
            return { embedString: `{{iframe: https://www.tiktok.com/player/v1/${m[2]}?autoplay=0}}`, note: "TikTok iframe." };
        }

        function tryInstagram(url) {
            const m = url.match(/^https?:\/\/(www\.)?instagram\.com\/(p|reel)\/([^/?#]+)\/?/i);
            if (!m) return null;
            const code = m[3];
            return { embedString: `{{iframe: https://www.instagram.com/p/${code}/embed}}`, note: "Instagram iframe." };
        }

        function tryPinterest(url) {
            const m = url.match(/^https?:\/\/(www\.)?pinterest\.[^/]+\/pin\/([^/?#]+)\/?/i);
            if (!m) return null;
            const id = m[2];
            return { embedString: `{{iframe: https://assets.pinterest.com/ext/embed.html?id=${id}}}`, note: "Pinterest iframe." };
        }

        async function trySoundCloudOEmbed(url) {
            if (!/^https?:\/\/(www\.)?soundcloud\.com\//i.test(url)) return null;

            const oembedUrl = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`;
            try {
                const res = await fetchWithTimeout(oembedUrl, { method: "GET" }, 2500);
                if (!res.ok) throw new Error(`SoundCloud oEmbed failed: ${res.status}`);
                const data = await res.json();
                const srcMatch = (data.html || "").match(/src="([^"]+)"/i);
                if (!srcMatch) throw new Error("SoundCloud oEmbed missing iframe src");
                const src = srcMatch[1];
                return { embedString: `{{iframe: ${src}}}`, note: "SoundCloud embed (oEmbed)." };
            } catch {
                const fallback = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}`;
                return { embedString: `{{iframe: ${fallback}}}`, note: "SoundCloud embed (player fallback)." };
            }
        }

        function tryGoogleMaps(url) {
            if (!/google\.[^/]+\/maps/i.test(url) && !/maps\.app\.goo\.gl/i.test(url)) return null;
            if (/\/maps\/embed\?/i.test(url)) return { embedString: `{{iframe: ${url}}}`, note: "Google Maps embed." };
            return { embedString: `{{iframe: ${url}}}`, note: "Google Maps iframe (best-effort)." };
        }

        function tryTwitch(url) {
            const clip1 = url.match(/^https?:\/\/clips\.twitch\.tv\/([^/?#]+)/i);
            const clip2 = url.match(/^https?:\/\/(www\.)?twitch\.tv\/[^/]+\/clip\/([^/?#]+)/i);
            const clipSlug = clip1?.[1] || clip2?.[2];
            if (clipSlug) {
                return {
                    embedString: `{{iframe: https://clips.twitch.tv/embed?clip=${encodeURIComponent(clipSlug)}&parent=roamresearch.com}}`,
                    note: "Twitch clip (parent=roamresearch.com).",
                };
            }

            const vid = url.match(/^https?:\/\/(www\.)?twitch\.tv\/videos\/(\d+)/i);
            if (vid) {
                return {
                    embedString: `{{iframe: https://player.twitch.tv/?video=${vid[2]}&parent=roamresearch.com}}`,
                    note: "Twitch video (parent=roamresearch.com).",
                };
            }

            return null;
        }

        function tryCodePen(url) {
            const m = url.match(/^https?:\/\/(www\.)?codepen\.io\/([^/]+)\/pen\/([^/?#]+)/i);
            if (!m) return null;
            return { embedString: `{{iframe: https://codepen.io/${m[2]}/embed/${m[3]}?default-tab=result}}`, note: "CodePen embed." };
        }

        function tryJSFiddle(url) {
            const m = url.match(/^https?:\/\/(www\.)?jsfiddle\.net\/([^/]+)(\/([^/]+))?\/?/i);
            if (!m) return null;
            const maybeUser = m[4] ? m[2] : null;
            const id = m[4] ? m[4] : m[2];
            const embed = maybeUser
                ? `https://jsfiddle.net/${maybeUser}/${id}/embedded/result/`
                : `https://jsfiddle.net/${id}/embedded/result/`;
            return { embedString: `{{iframe: ${embed}}}`, note: "JSFiddle embed." };
        }

        function tryExcalidrawLink(url) {
            if (!/^https?:\/\/(www\.)?excalidraw\.com\//i.test(url)) return null;
            return { embedString: `{{iframe: ${url}}}`, note: "Excalidraw iframe." };
        }

        function tryGitHubNormalize(url) {
            if (!/^https?:\/\/(www\.)?github\.com\//i.test(url)) return null;

            // If user already pasted raw.githubusercontent.com, it will be handled by file matchers.
            return { embedString: `{{iframe: ${url}}}`, note: "GitHub iframe (best-effort)." };
        }

        function tryMedium(url) {
            if (!/^https?:\/\/(www\.)?medium\.com\//i.test(url) && !/^https?:\/\/[^/]+\.medium\.com\//i.test(url)) return null;
            return { embedString: `{{iframe: ${url}}}`, note: "Medium iframe (best-effort)." };
        }

        function trySubstack(url) {
            if (!/^https?:\/\/[^/]+\.substack\.com\//i.test(url)) return null;
            return { embedString: `{{iframe: ${url}}}`, note: "Substack iframe (best-effort)." };
        }

        function trySlideshare(url) {
            if (!/^https?:\/\/(www\.)?slideshare\.net\//i.test(url)) return null;
            // Slideshare often works via oEmbed; we try iframe now, and oEmbed later will improve it if possible.
            return { embedString: `{{iframe: ${url}}}`, note: "SlideShare iframe (best-effort)." };
        }

        function tryFigmaOrFigJam(url) {
            if (!/^https:\/\/([\w.-]+\.)?figma\.com\//i.test(url)) return null;
            const embedUrl = `https://www.figma.com/embed?embed_host=roam&url=${encodeURIComponent(url)}`;
            return { embedString: `{{iframe: ${embedUrl}}}`, note: "Figma/FigJam iframe embed." };
        }

        function tryAudio(url) {
            if (!/\.(mp3|wav|aiff|aac|ogg|wma|flac|alac)(\?|#|$)/i.test(url)) return null;
            return { embedString: `{{[[audio]]: ${url}}}`, note: "Audio embed." };
        }

        function tryVideoFile(url) {
            if (!/\.(avi|mpg|mpeg|mov|mkv|mp4|wmv|webm)(\?|#|$)/i.test(url)) return null;
            return { embedString: `{{[[video]]: ${url}}}`, note: "Video file embed." };
        }

        function tryImage(url) {
            if (!/\.(jpg|jpeg|bmp|gif|png|tiff|webp)(\?|#|$)/i.test(url)) return null;
            return { embedString: `![](${url})`, note: "Image embed." };
        }

        async function tryGenericOEmbedNoembed(url) {
            // Late-stage: attempt oEmbed via noembed (supports lots of providers)
            // This is intentionally AFTER core handlers, so it won't override your preferred formats.
            const oembedUrl = `https://noembed.com/embed?url=${encodeURIComponent(url)}`;

            try {
                const res = await fetchWithTimeout(oembedUrl, { method: "GET" }, 2500);
                if (!res.ok) return null;

                const data = await res.json();
                const html = data?.html;
                if (!html || typeof html !== "string") return null;

                // Extract iframe src
                const srcMatch = html.match(/<iframe[^>]*\s+src="([^"]+)"[^>]*>/i);
                if (!srcMatch) return null;

                const src = srcMatch[1];
                return { embedString: `{{iframe: ${src}}}`, note: "Embedded via oEmbed." };
            } catch {
                return null;
            }
        }

        function tryWebsiteIframe(url) {
            return { embedString: `{{iframe: ${url}}}`, note: "Website iframe." };
        }

        // -------------------- Mermaid --------------------

        function extractMermaid(text) {
            if (!text) return null;
            const normalised = String(text).replace(/\\n/g, "\n");

            const fenced =
                normalised.match(/```mermaid\s*[\r\n]+([\s\S]*?)```/i) ||
                normalised.match(/```mermaid\s*[\r\n]+([\s\S]*)$/i);
            if (fenced) {
                const body = fenced[1].trim();
                return splitMermaidLines(body);
            }

            const startsMermaid =
                /^\s*(graph\s+(TD|LR|TB|RL)|sequenceDiagram|flowchart\s+(TD|LR|TB|RL)|classDiagram|stateDiagram|erDiagram|gantt|journey|mindmap|timeline|gitGraph|requirementDiagram|quadrantChart|xychart-beta)\b/i.test(
                    normalised
                );
            if (startsMermaid) return splitMermaidLines(normalised.trim());

            return null;
        }

        function splitMermaidLines(body) {
            return String(body || "")
                .split(/\r?\n/)
                .map((line) => line.trimEnd())
                .filter((line) => line.length);
        }

        // -------------------- Excalidraw --------------------

        function parseExcalidraw(text) {
            if (!text) return null;
            try {
                const data = JSON.parse(text);
                if (!data || typeof data !== "object") return null;
                if (data.type !== "excalidraw") return null;
                if (!Array.isArray(data.elements)) return null;
                if (!data.appState || typeof data.appState !== "object") return null;
                return data;
            } catch {
                return null;
            }
        }

        async function importExcalidrawToRoam({
            excalidraw,
            roamExcalidrawVersion = "0.18.0",
            targetUid,
        }) {
            if (!targetUid) throw new Error("targetUid is required");
            if (!excalidraw || typeof excalidraw !== "object") throw new Error("excalidraw object is required");

            const elements = Array.isArray(excalidraw.elements) ? excalidraw.elements : [];
            const appState = excalidraw.appState && typeof excalidraw.appState === "object" ? excalidraw.appState : {};
            const files = excalidraw.files && typeof excalidraw.files === "object" ? excalidraw.files : {};

            const uid = targetUid;
            const instanceId = (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()));

            await window.roamAlphaAPI.updateBlock({
                block: {
                    uid,
                    string: "{{excalidraw}}",
                    props: {
                        "excalidraw/instance-id": instanceId,
                        "excalidraw/elements-json": JSON.stringify(elements),
                        "excalidraw/state-json": JSON.stringify(appState),
                        "excalidraw/files-json": JSON.stringify(files),
                        "excalidraw/version": roamExcalidrawVersion,
                    },
                },
            });

            return uid;
        }

        // -------------------- URL helpers --------------------

        function extractUrls(text) {
            const urls = [];

            // markdown links [text](url)
            const md = [...text.matchAll(/\[[^\]]*]\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]);
            for (const u of md) urls.push(u);

            // raw urls
            const raw = [...text.matchAll(/https?:\/\/[^\s<>"']+/g)].map((m) => m[0]);
            for (const u of raw) urls.push(u);

            return [...new Set(urls.map((u) => u.trim()))].filter((u) => isUrl(u));
        }

        function normalizeUrl(url) {
            let u = (url || "").trim();
            u = u.replace(/[)\].,;!]+$/, "");

            try {
                const parsed = new URL(u);

                // Strip common tracking params
                const toDelete = [];
                for (const [k] of parsed.searchParams.entries()) {
                    if (/^utm_/i.test(k) || /^(fbclid|gclid|mc_cid|mc_eid|igshid)$/i.test(k)) {
                        toDelete.push(k);
                    }
                }
                toDelete.forEach((k) => parsed.searchParams.delete(k));

                // Minor YouTube cleanup: remove si/list/feature (keep t)
                if (/youtube\.com|youtu\.be/i.test(parsed.hostname)) {
                    ["si", "feature"].forEach((k) => parsed.searchParams.delete(k));
                }

                u = parsed.toString();
            } catch {
                // ignore
            }

            // If GitHub blob -> raw, rewrite here so downstream handlers detect file type
            const gh = u.match(/^https?:\/\/(www\.)?github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
            if (gh) {
                const user = gh[2];
                const repo = gh[3];
                const branch = gh[4];
                const path = gh[5];
                u = `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${path}`;
            }

            return u;
        }

        function getUrlParam(url, key) {
            try {
                const u = new URL(url);
                return u.searchParams.get(key);
            } catch {
                return null;
            }
        }

        async function fetchWithTimeout(url, options = {}, timeoutMs = 2500) {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeoutMs);
            try {
                return await fetch(url, { ...options, signal: controller.signal });
            } finally {
                clearTimeout(id);
            }
        }

        // -------------------- Toast --------------------

        function toast(message) {
            const msg = String(message || "").trim();
            if (!msg) return;

            try {
                const toastEl = getToastElement();
                toastEl.textContent = msg;
                toastEl.classList.add("pe-toast--show");
                clearTimeout(toastHideTimer);
                toastHideTimer = setTimeout(() => {
                    toastEl.classList.remove("pe-toast--show");
                }, 2500);
                return;
            } catch { }

            console.info("[Shortcode Embed]", msg);
        }

        function getToastElement() {
            let el = document.getElementById("pe-toast");
            if (el) return el;

            const styleId = "pe-toast-style";
            let style = document.getElementById(styleId);
            if (!style) {
                style = document.createElement("style");
                style.id = styleId;
                document.head.appendChild(style);
            }
            style.textContent =
                "#pe-toast{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:#1f1f1f;color:#fff;padding:10px 14px;border-radius:6px;font-size:13px;line-height:1.3;opacity:0;transition:opacity .2s ease,transform .2s ease;z-index:999999;pointer-events:none;max-width:80vw;box-shadow:0 6px 20px rgba(0,0,0,.25);}"+
                "#pe-toast.pe-toast--show{opacity:1;transform:translate(-50%,-50%) scale(1.02);}";

            el = document.createElement("div");
            el.id = "pe-toast";
            document.body.appendChild(el);

            // Ensure we only clean up resources created by this extension.
            toastCleanup = () => {
                const existing = document.getElementById("pe-toast");
                clearTimeout(toastHideTimer);
                toastHideTimer = null;
                existing?.remove();
                document.getElementById("pe-toast-style")?.remove();
            };
            return el;
        }

        function isRoamApiAvailable() {
            const api = window.roamAlphaAPI;
            return !!(api && api.ui?.getFocusedBlock && api.updateBlock && api.createBlock && api.util?.generateUID);
        }

        async function createSiblingAndFocus(focusedUid) {
            const api = window.roamAlphaAPI;
            if (!api?.data?.pull || !api?.createBlock || !api?.util?.generateUID) {
                return null;
            }

            let parentUid = null;
            let order = null;
            try {
                const res = api.data.pull(
                    "[:block/uid :block/order {:block/parents [:block/uid]} {:block/page [:block/uid]}]",
                    [":block/uid", focusedUid]
                );
                const parents = res?.[":block/parents"];
                parentUid = Array.isArray(parents) && parents.length ? parents[0]?.[":block/uid"] : null;
                if (!parentUid) {
                    parentUid = res?.[":block/page"]?.[":block/uid"] || null;
                }
                order = typeof res?.[":block/order"] === "number" ? res[":block/order"] : null;
            } catch {
                return null;
            }

            if (!parentUid) {
                return null;
            }

            const newUid = api.util.generateUID();
            try {
                await api.createBlock({
                    location: { "parent-uid": parentUid, order: order === null ? "last" : order + 1 },
                    block: { uid: newUid, string: "" },
                });
            } catch {
                return null;
            }

            // Roam tends to retain focus on the original block after programmatic edits.
            // A body click reliably releases that focus so the new sibling can be edited.
            document.querySelector("body")?.click();
            return newUid;
        }

    },

    onunload: () => {
        toastCleanup?.();
        toastCleanup = null;
    },
};

function isUrl(s) {
    try {
        const u = new URL(s);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

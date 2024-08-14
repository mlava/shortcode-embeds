export default {
    onload: ({ extensionAPI }) => {
        extensionAPI.ui.commandPalette.addCommand({
            label: "Paste Embed from clipboard",
            callback: () => embedClip()
        });

        async function embedClip() {
            const clipText = await navigator.clipboard.readText();
            var startBlock = await window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
            if (!startBlock) {
                alert("Please place your cursor in a block to embed in your graph")
            } else {
                let q = `[:find (pull ?page [:node/title :block/string :block/uid ]) :where [?page :block/uid "${startBlock}"]  ]`;
                var info = await window.roamAlphaAPI.q(q);
            }

            const videoRegex = /^https?:\/\/(.+\/)+.+(\.(avi|mpg|mpeg|mov|mkv|mp4|wmv|webm))$/;
            const vimeoRegex = /^(http|https)?:\/\/(www\.)?vimeo.com.+/;
            const imageRegex = /^https?:\/\/(.+\/)+.+(\.(jpg|jpeg|bmp|gif|png|tiff|webp))$/;
            const instagramRegex = /\.+instagram\.com.*?\/p\/(.*)\//;
            const tiktokRegex = /\.+tiktok\.com.*?\/video\/(.*)\/?/;
            const audioRegex = /^https?:\/\/(.+\/)+.+(\.(mp3|wav|aiff|aac|ogg|wma|flac|alac))$/;
            const figmaRegex = /https:\/\/([\w\.-]+\.)?figma.com\/(file|proto)\/([0-9a-zA-Z]{22,128})(?:\/.*)?$/;
            const websiteRegex = /(https?:\/\/)?(www\.)[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,4}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)|(https?:\/\/)?(www\.)?(?!ww)[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,4}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/;
            var embedString;
            var embedState = true;

            if (!isUrl(clipText)) {
                alert('Please make sure that the clipboard contains a valid url');
                embedState = false;
            } else {
                if (clipText.match("youtu")) { // youtube
                    embedString = "{{youtube: " + clipText + "}}";
                } else if (clipText.match("wikipedia")) { // convert wikipedia link to mobile version
                    const regex = /(https:\/\/[a-z]{2}.)(wikipedia.org\/.+)/g;
                    const subst = `$1m.$2`;
                    const result = clipText.replace(regex, subst);
                    embedString = "{{iframe: " + result + "}}";
                } else if (vimeoRegex.test(clipText)) { // vimeo
                    embedString = "{{[[video]]: " + clipText + "}}";
                } else if (videoRegex.test(clipText)) { // video but not youtube or vimeo
                    embedString = "{{[[video]]: " + clipText + "}}";
                } else if (tiktokRegex.test(clipText)) { // video but not youtube or vimeo
                    let code = clipText.match(tiktokRegex);
                    embedString = "{{[[iframe]]: https://www.tiktok.com/player/v1/" + code[1] + "?autoplay=0}}";
                } else if (imageRegex.test(clipText)) { // image
                    embedString = "![](" + clipText + ")";
                } else if (instagramRegex.test(clipText)) { // instagram
                    let code = clipText.match(instagramRegex);
                    embedString = "{{[[iframe]]: https://www.instagram.com/p/" + code[1] + "/embed}}";
                } else if (audioRegex.test(clipText)) { // audio
                    embedString = "{{[[audio]]: " + clipText + "}}";
                } else if (clipText.match(/^https?:\/\/(.+\/)+.+(\.(pdf))$/)) { // pdf
                    embedString = "{{pdf: " + clipText + "}}";
                } else if (figmaRegex.test(clipText)) { // figma
                    embedString = "{{figma: " + clipText + "}}";
                } else if (websiteRegex.test(clipText)) { // iframe for website
                    embedString = "{{iframe: " + clipText + "}}";
                } else {
                    alert("No matches to Roam Research embed shortcodes were found");
                    embedState = false;
                }
            }
            if (info.length > 0 && embedState == true) {
                await window.roamAlphaAPI.updateBlock(
                    { block: { uid: info[0][0].uid, string: embedString.toString(), open: true } });
                await sleep(50);
                document.querySelector("body")?.click();
            }
        }
    },
    onunload: () => {
        // nothing left here!
    }
}

function isUrl(s) {
    var regexp = /(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/
    return regexp.test(s);
}
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
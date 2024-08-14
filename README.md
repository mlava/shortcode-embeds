This simple extension reads the content of your clipboard and then determines what kind of file you are trying to embed.

**NEW:**
- convert Wikipedia links to mobile Wikipedia for better iframe experience
- Now compatible with the new user-defined hotkeys function - see Hotkeys option in Roam Research Settings

Trigger via the Command Palette using the command 'Paste Embed from clipboard'. Or, configure a keyboard shortcut in Settings > Hotkeys.

It will automatically recognise:

- YouTube videos for {{youtube: url}}
- Vimeo videos for {{[[video]]: url}}
- Tiktok videos
- Figma diagrams for{{figma: url}}
- PDFs for {{pdf: url}}
- websites (for iframe embed) for {{iframe: url}}
- images for ![](url)
  - jpg|jpeg|bmp|gif|png|tiff|webp
- Instagram images
- audio files for {{[[audio]]: url}}
  - mp3|wav|aiff|aac|ogg|wma|flac|alac
- video files for {{[[video]]: url}}
  - avi|mpg|mpeg|mov|mkv|mp4|wmv|webm

Let me know if there are other formats that need to be added. I can also update if Roam Research adds more {{ shortcodes }}.
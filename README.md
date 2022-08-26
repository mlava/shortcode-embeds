This simple extension reads the content of your clipboard and then determines what kind of file you are trying to embed.

Trigger via the Command Palette using the command 'Paste Embed from clipboard'.

It will automatically recognise:

- YouTube videos for {{youtube: url}}
- Vimeo videos for {{[[video]]: url}}
- Figma diagrams for{{figma: url}}
- PDFs for {{pdf: url}}
- websites (for iframe embed) for {{iframe: url}}
- images for ![](url)
  - jpg|jpeg|bmp|gif|png|tiff|webp
- audio files for {{[[audio]]: url}}
  - mp3|wav|aiff|aac|ogg|wma|flac|alac
- video files for {{[[video]]: url}}
  - avi|mpg|mpeg|mov|mkv|mp4|wmv|webm

Let me know if there are other formats that need to be added. I can also update if Roam Research adds more {{ shortcodes }}.

TODO:
1. implement a keyboard shortcut in addition to the Command Palette command.

# Detetive Kapi Landing

Landing page estatica da Detetive Kapi, a Detetive Kapi de cupons, promocoes e achadinhos no WhatsApp.

## Deploy

Este projeto foi preparado para Render Static Site.

- Build command: `true`
- Publish directory: `.`
- Custom domain: `kapivara.co`

Os arquivos principais de SEO estao na raiz: `robots.txt`, `sitemap.xml`, `llms.txt`, `site.webmanifest`, `termos.html` e `privacidade.html`.

## QR Code

O QR Code do rodape aponta para `qr.html?src=footer_qr`, que redireciona para o WhatsApp `+5511989419928`.

A pagina `qr.html` tambem dispara o evento `qr_code_open` no `dataLayer` e tenta enviar o payload para `POST /api/qr-open`. Para contabilizar leituras e incluir o total no e-mail de resumo diario, esse endpoint precisa ser implementado em um backend seguro ou ferramenta de analytics conectada ao e-mail diario.

<!DOCTYPE html>
<html lang="\{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="csp-nonce" content="\{{ app('csp-nonce') }}">
        <meta name="csrf-token" content="\{{ csrf_token() }}">
        <title>\{{ config('app.name', 'Laravel') }}</title>

        @viteReactRefresh
        @vite(['resources/react/{{ app.key }}/assets/css/app.css', 'resources/react/{{ app.key }}/src/app.tsx'])
    </head>
    <body class="font-sans antialiased">
        <div id="root"></div>
    </body>
</html>

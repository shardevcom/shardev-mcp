<!DOCTYPE html>
<html lang="\{{ str_replace('_', '-', app()->getLocale()) }}">
    <body style="font-family: sans-serif; color: #111;">
        <p>\{{ __('Your sign-in code for :app is:', ['app' => config('app.name')]) }}</p>
        <p style="font-size: 28px; letter-spacing: 6px;"><strong>\{{ $code }}</strong></p>
        <p>\{{ __('It expires in :minutes minutes and works only once. If you did not ask for it, ignore this email.', ['minutes' => $minutes]) }}</p>
    </body>
</html>

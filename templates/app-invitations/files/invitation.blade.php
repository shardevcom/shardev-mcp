<!DOCTYPE html>
<html lang="\{{ str_replace('_', '-', app()->getLocale()) }}">
    <body style="font-family: sans-serif; color: #111;">
        <p>\{{ __('You have been invited to :app.', ['app' => config('app.name')]) }}</p>
        <p><a href="\{{ $url }}">\{{ __('Accept the invitation') }}</a></p>
        <p>\{{ __('The link works only once and expires in :days days. If you did not expect this email, ignore it.', ['days' => $days]) }}</p>
    </body>
</html>

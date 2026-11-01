<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ $subject }}</title>
</head>
<body style="margin:0;padding:24px;background:#f8fafc;color:#0f172a;font-family:Arial, Helvetica, sans-serif;">
    <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;box-shadow:0 10px 30px rgba(15,23,42,.08);">
        <p style="margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;">
            {{ $appName }}
        </p>

        <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;">
            Your verification code
        </h1>

        <p style="margin:0 0 18px;font-size:15px;line-height:1.7;">
            Use the following verification code to continue your identity validation flow.
        </p>

        <div style="margin:0 0 18px;padding:18px 20px;border-radius:14px;background:#0f172a;color:#ffffff;font-size:32px;font-weight:700;letter-spacing:.28em;text-align:center;">
            {{ $code }}
        </div>

        <p style="margin:0 0 10px;font-size:14px;line-height:1.7;">
            This code expires in {{ $ttl }} minutes.
        </p>

        @if(!empty($purpose))
            <p style="margin:0 0 10px;font-size:13px;color:#475569;">
                Purpose: {{ $purpose }}
            </p>
        @endif

        <p style="margin:18px 0 0;font-size:13px;color:#64748b;">
            If you did not request this code, you can ignore this message.
        </p>
    </div>
</body>
</html>

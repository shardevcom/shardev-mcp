<?php

use Illuminate\Support\Facades\Route;
use Shardevcom\Verification\Http\Controllers\VerificationController;

Route::prefix(config('verification.route.prefix', 'verification'))
    ->middleware(config('verification.route.middleware', []))
    ->group(function () {
        Route::post('/request', [VerificationController::class, 'request'])->name('verification.request');
        Route::post('/verify', [VerificationController::class, 'verify'])->name('verification.verify');
        Route::post('/resend', [VerificationController::class, 'resend'])->name('verification.resend');
    });

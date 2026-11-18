package com.curioplanet.voice;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/** Curio Voice: hosts the on-device Kokoro narration app in a WebView. */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private WebView web;
    private File pendingFile;
    private FileOutputStream pendingOut;
    private String pendingName;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "Android");
        setContentView(web);

        if (state != null) web.restoreState(state);
        else web.loadUrl("https://" + HOST + "/assets/index.html");
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    /** Lets the web app hand finished audio to Android in chunks (large files are fine). */
    class Bridge {
        @JavascriptInterface
        public String begin(String name) {
            try {
                File dir = new File(getCacheDir(), "shared");
                if (!dir.exists()) dir.mkdirs();
                pendingName = name.replaceAll("[^A-Za-z0-9._-]", "_");
                pendingFile = new File(dir, pendingName);
                pendingOut = new FileOutputStream(pendingFile);
                return "ok";
            } catch (Exception e) { return "error: " + e.getMessage(); }
        }

        @JavascriptInterface
        public String chunk(String b64) {
            try { pendingOut.write(Base64.decode(b64, Base64.DEFAULT)); return "ok"; }
            catch (Exception e) { return "error: " + e.getMessage(); }
        }

        @JavascriptInterface
        public String finish(boolean share) {
            try {
                pendingOut.close();
                if (share) {
                    final Uri uri = FileProvider.getUriForFile(MainActivity.this, "com.curioplanet.voice.files", pendingFile);
                    final Intent send = new Intent(Intent.ACTION_SEND)
                            .setType("audio/wav")
                            .putExtra(Intent.EXTRA_STREAM, uri)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    runOnUiThread(() -> startActivity(Intent.createChooser(send, "Share narration")));
                    return "Choose where to share it.";
                }
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, pendingName);
                cv.put(MediaStore.Downloads.MIME_TYPE, "audio/wav");
                cv.put(MediaStore.Downloads.RELATIVE_PATH, "Download/CurioVoice");
                Uri dest = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                try (OutputStream os = getContentResolver().openOutputStream(dest);
                     InputStream is = new FileInputStream(pendingFile)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = is.read(buf)) > 0) os.write(buf, 0, n);
                }
                return "Saved to Downloads/CurioVoice/" + pendingName;
            } catch (Exception e) { return "error: " + e.getMessage(); }
        }
    }
}

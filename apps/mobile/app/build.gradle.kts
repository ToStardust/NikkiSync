plugins { id("com.android.application") }

android {
    namespace = "app.nikkisync.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.nikkisync.mobile"
        minSdk = 33
        targetSdk = 35
        versionCode = 16
        versionName = "0.2.15-about"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release { isMinifyEnabled = false }
    }

    buildFeatures { buildConfig = true }
    testOptions { unitTests.isIncludeAndroidResources = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // Lightweight Ed25519 only; do not register a global BC provider or rely on OEM JCA order.
    implementation("org.bouncycastle:bcprov-jdk18on:1.86")
    implementation("androidx.recyclerview:recyclerview:1.4.0")
    // 1.13.0 requires SDK 36 / AGP 8.9.1; this branch intentionally builds on SDK 35 / AGP 8.7.3.
    implementation("androidx.activity:activity:1.10.1")
    implementation("com.google.zxing:core:3.5.3")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    // Pin together: quarter-turn optimization and portrait encoding were reviewed at this tag.
    implementation("androidx.media3:media3-transformer:1.8.0")
    implementation("androidx.media3:media3-effect:1.8.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.robolectric:robolectric:4.17")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}

// Keep the user-facing APK beside the existing desktop bundle after an Android build.
tasks.register<Copy>("stageDebugApk") {
    dependsOn("assembleDebug")
    from(layout.buildDirectory.file("outputs/apk/debug/app-debug.apk")) {
        rename { "NikkiSync-Android.apk" }
    }
    into(rootProject.projectDir.resolve("../../release/NikkiSync"))
}

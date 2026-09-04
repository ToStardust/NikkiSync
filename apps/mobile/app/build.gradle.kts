plugins {
    id("com.android.application")
}

android {
    namespace = "app.nikkisync.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.nikkisync.mobile"
        minSdk = 33
        targetSdk = 35
        versionCode = 1
        versionName = "0.2.0-m2"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.zxing:core:3.5.3")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}

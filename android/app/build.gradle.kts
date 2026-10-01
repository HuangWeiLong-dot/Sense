plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "ai.sense.app"
    // Compose 1.12 / OkHttp 5 要求 compileSdk ≥ 37；
    // targetSdk 停在 36：用最新 API 编译，但不抢先跟进未验证的运行时行为变更。
    compileSdk = 37

    defaultConfig {
        applicationId = "ai.sense.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // Web 产物（dist/）在构建时同步到 assets，不手工复制、也不会两处不一致。
    // 这里用普通路径而不是 Provider：AGP 9 不允许把 Provider 加进 SourceSet API。
    sourceSets.getByName("main") {
        assets.srcDir("build/webassets")
    }
}

/**
 * 把仓库根目录的 dist/ 同步成 assets/www/。
 * gradle 会做增量判断，Web 代码没变时不会重复拷贝。
 */
val syncWebAssets by tasks.registering(Sync::class) {
    from(rootProject.file("../dist"))
    into(layout.buildDirectory.dir("webassets/www"))
}

tasks.named("preBuild") {
    dependsOn(syncWebAssets)
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.11.0")
    implementation("androidx.webkit:webkit:1.17.1")
    implementation("com.squareup.okhttp3:okhttp:5.5.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
}

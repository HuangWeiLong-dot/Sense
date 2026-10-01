plugins {
    // AGP 9 起内置 Kotlin 支持，不再需要 org.jetbrains.kotlin.android 插件
    id("com.android.application") version "9.4.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.20" apply false
}

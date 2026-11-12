fn main() {
    // tauri_build only re-runs for tauri.conf.json / capabilities changes; without this the exe keeps
    // embedding the old icon after `pnpm tauri icon` regenerates icons/.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}

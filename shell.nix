# shell.nix
{ pkgs ? import <nixpkgs> {} }:
let
  runtimeLibs = with pkgs; [
    util-linux   # libuuid
    glib         # g_memdup2 and friends (GLib ≥ 2.68)
    cairo        # libcairo, libcairo-gobject
    pango        # libpango, libpangocairo
    harfbuzz     # libharfbuzz (pango runtime dep)
    pixman       # libpixman
    libjpeg      # libjpeg
    giflib       # libgif
    librsvg      # librsvg
    freetype     # libfreetype (FT_Get_Transform)
    fontconfig   # libfontconfig
  ];
in
pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs
    python3
    pkg-config
    firefox
  ] ++ runtimeLibs;

  # Expose the full set of native libs so node addons (canvas, prismarine-viewer)
  # and the headless browser can find them at runtime without relying on the
  # system ld.so cache (which may point to older versions on NixOS).
  LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath runtimeLibs;
}

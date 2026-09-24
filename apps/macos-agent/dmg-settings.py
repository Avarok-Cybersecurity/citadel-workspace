# dmgbuild settings for "Citadel Agent.dmg": the window with the app beside Applications.
#
#   dmgbuild -s apps/macos-agent/dmg-settings.py -D app="<path>/Citadel Agent.app" \
#            -D background=apps/macos-agent/dmg-background.tiff "Citadel Agent" <out.dmg>
#
# dmgbuild writes the window's .DS_Store itself. The usual alternative, scripting Finder, needs a
# logged-in Finder that a CI runner may refuse (-1743), and then silently ships a bare window.
# dmg-background.py reads the geometry below, so the drawn arrow and the icons cannot disagree.
import os.path

WINDOW = (660, 440)
ICON_SIZE = 128
APP_AT = (170, 190)
APPLICATIONS_AT = (490, 190)

app = defines["app"]  # noqa: F821 -- dmgbuild supplies `defines`
app_name = os.path.basename(app)

format = "UDZO"
compression_level = 9
filesystem = "HFS+"
files = [app]
symlinks = {"Applications": "/Applications"}
# "Citadel Agent", not "Citadel Agent.app".
hide_extensions = [app_name]
icon_locations = {app_name: APP_AT, "Applications": APPLICATIONS_AT}
background = defines["background"]  # noqa: F821
window_rect = ((200, 160), WINDOW)
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
icon_size = ICON_SIZE
text_size = 13
arrange_by = None

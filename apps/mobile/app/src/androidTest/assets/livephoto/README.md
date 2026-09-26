# Synthetic Live rotation test assets

Before building/running `LivePhotoRotationInstrumentedTest`, generate the two binary assets from the repository root:

```sh
python -m pip install Pillow
# Install ffmpeg separately if it is not already on PATH.
python tools/livephoto/generate-fixtures.py
```

This writes `corners.jpg` and `corners-audio.mp4` here. They are deliberately generated rather than copied from private player/device photos. The JPEG has red/green/blue/yellow quadrants; the MP4 is 320x180, 24 video frames, one second, H.264 + an AAC 440 Hz test tone.

The generator was executed in the authoring environment and ffprobe confirmed those stream properties. This does NOT mean Android rotation or OEM gallery playback has passed. Re-generating with different FFmpeg versions may produce different binary hashes without changing the required fixture behavior.

After generation, run from `apps/mobile`:

```sh
./gradlew testDebugUnitTest assembleDebug assembleDebugAndroidTest
./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=app.nikkisync.mobile.media.live.LivePhotoRotationInstrumentedTest
```

The second command runs on connected Android hardware/emulator and must be explicitly authorized for the selected device. Do not silently skip tests when the assets or codec are missing. The test never inserts fixtures into the user's gallery.

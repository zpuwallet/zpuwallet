import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:zkool/utils.dart';

/// Drop-in replacement for [SharedPreferencesAsync] that, in the portable
/// build, persists settings to a JSON file under `./db` (next to the exe) so
/// the portable app is fully self-contained. In non-portable builds it
/// delegates to a real [SharedPreferencesAsync], so behavior is unchanged.
///
/// Only the method surface actually used by the app is mirrored:
/// getString/getBool/getInt, setString/setBool/setInt, remove.
class AppPrefs {
  static AppPrefs? _instance;
  factory AppPrefs() => _instance ??= AppPrefs._();
  AppPrefs._();

  SharedPreferencesAsync? _native; // non-portable backend
  Map<String, Object?>? _cache; // portable in-memory cache
  File? _file;

  bool get _portable => isPortable;

  SharedPreferencesAsync get _nativeStore => _native ??= SharedPreferencesAsync();

  /// Optionally call once early (e.g. in main) so the first read is warm.
  /// Reads are also self-initializing, so this is not strictly required.
  Future<void> init() async {
    if (_portable) {
      await _ensureLoaded();
    } else {
      _native ??= SharedPreferencesAsync();
    }
  }

  Future<void> _ensureLoaded() async {
    if (_cache != null) return;
    final dir = await getDataDirectory(); // creates ./db in portable mode
    _file = File(joinPath(dir.path, 'settings.json'));
    if (await _file!.exists()) {
      try {
        final txt = await _file!.readAsString();
        final m = jsonDecode(txt) as Map<String, dynamic>;
        _cache = Map<String, Object?>.from(m);
      } catch (_) {
        _cache = {}; // corrupt/empty -> start fresh rather than crash
      }
    } else {
      _cache = {};
    }
  }

  Future<void> _flush() async {
    // Write to a temp file then rename for an atomic-ish replace, so a crash
    // mid-write can't leave a half-written settings.json.
    final tmp = File('${_file!.path}.tmp');
    await tmp.writeAsString(jsonEncode(_cache), flush: true);
    await tmp.rename(_file!.path);
  }

  Future<Object?> _read(String k) async {
    await _ensureLoaded();
    return _cache![k];
  }

  Future<String?> getString(String k) async =>
      _portable ? (await _read(k)) as String? : _nativeStore.getString(k);

  Future<bool?> getBool(String k) async =>
      _portable ? (await _read(k)) as bool? : _nativeStore.getBool(k);

  Future<int?> getInt(String k) async =>
      _portable ? (await _read(k)) as int? : _nativeStore.getInt(k);

  Future<void> setString(String k, String v) => _write(k, v);
  Future<void> setBool(String k, bool v) => _write(k, v);
  Future<void> setInt(String k, int v) => _write(k, v);
  Future<void> remove(String k) => _write(k, null, removeKey: true);

  Future<void> _write(String k, Object? v, {bool removeKey = false}) async {
    if (!_portable) {
      final n = _nativeStore;
      if (removeKey) return n.remove(k);
      if (v is String) return n.setString(k, v);
      if (v is bool) return n.setBool(k, v);
      if (v is int) return n.setInt(k, v);
      return;
    }
    await _ensureLoaded();
    if (removeKey) {
      _cache!.remove(k);
    } else {
      _cache![k] = v;
    }
    await _flush();
  }
}

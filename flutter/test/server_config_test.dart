import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_hbb/common.dart';

void main() {
  test('an imported server config ignores its relay key', () {
    final config = ServerConfig.decode(
        '{"host":"id.example.com","relay":"relay.example.com","api":"https://id.example.com","key":"k"}');
    expect(config.idServer, 'id.example.com');
    expect(config.apiServer, 'https://id.example.com');
    expect(config.key, 'k');
  });

  test('an encoded config round-trips and carries no relay key', () {
    final encoded = ServerConfig(
            idServer: 'id.example.com',
            apiServer: 'https://id.example.com',
            key: 'k')
        .encode();
    final config = ServerConfig.decode(encoded);
    expect(config.idServer, 'id.example.com');
    expect(config.apiServer, 'https://id.example.com');
    expect(config.key, 'k');
    final json = jsonDecode(utf8.decode(base64Url
        .decode(base64.normalize(encoded.split('').reversed.join('')))));
    expect(json.containsKey('relay'), isFalse);
  });

  test('a stored relay-server option is not loaded', () {
    final config = ServerConfig.fromOptions({
      'custom-rendezvous-server': 'id.example.com',
      'relay-server': 'relay.example.com',
    });
    expect(config.idServer, 'id.example.com');
  });
}

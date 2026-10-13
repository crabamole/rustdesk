import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../common.dart';
import 'login.dart';

bool get isLoggedOut => gFFI.userModel.userName.value.isEmpty;

/// Stands in for the remote ID field while logged out: the server refuses viewers that are not
/// logged in.
class LoginPrompt extends StatelessWidget {
  const LoginPrompt({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(13),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(translate('Log in to connect to remote devices.'),
                style: const TextStyle(fontSize: 16)),
          ),
          ElevatedButton(
            onPressed: loginWithOneClick,
            style: ElevatedButton.styleFrom(
                padding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 16)),
            child: Text(translate('Login'), style: const TextStyle(fontSize: 16)),
          ),
        ],
      ),
    );
  }
}

/// Who is logged in. An icon, not a status dot: a client holds no connection to the server.
class AccountStatus extends StatelessWidget {
  final bool compact;
  const AccountStatus({Key? key, this.compact = false}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final label = gFFI.userModel.accountLabelWithHandle;
      if (compact && label.isEmpty) return const SizedBox.shrink();
      final color = Theme.of(context).hintColor;
      return Row(
        mainAxisSize: compact ? MainAxisSize.min : MainAxisSize.max,
        children: [
          Icon(Icons.account_circle_outlined, size: 16, color: color)
              .marginOnly(right: 6),
          Flexible(
            fit: compact ? FlexFit.loose : FlexFit.tight,
            child: Text(
              label.isEmpty
                  ? translate('Not logged in')
                  : translate('Logged in as {$label}'),
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 14),
            ),
          ),
          if (!compact && label.isNotEmpty)
            TextButton(
              onPressed: logOutConfirmDialog,
              child: Text(translate('Logout')),
            ),
        ],
      );
    });
  }
}

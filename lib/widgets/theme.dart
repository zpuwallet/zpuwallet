import 'package:flutter/material.dart';
import 'package:gap/gap.dart';
import 'package:zkool/utils.dart';

class DisplayPanel extends StatelessWidget {
  final Widget? child;
  const DisplayPanel({this.child, super.key});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Container(
      padding: EdgeInsetsGeometry.all(16),
      decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          gradient: LinearGradient(
            begin: AlignmentGeometry.topCenter,
            end: AlignmentGeometry.bottomCenter,
            colors: [
              cs.surface,
              Color.lerp(cs.surface, cs.primaryContainer, 0.3)!,
            ],
            stops: [0.0, 0.6],
          ),
          boxShadow: [
            BoxShadow(
              color: cs.shadow.withAlpha(30),
              blurRadius: 12,
              offset: Offset(0, 6),
            ),
          ]),
      child: child,
    );
  }
}

class BalanceChip extends StatelessWidget {
  final PoolType pool;
  final String value;
  const BalanceChip(this.pool, this.value, {super.key});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Chip(
      label: RichText(
        text: TextSpan(
          children: [
            TextSpan(
              text: "${pool.label} ",
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: poolTypeColor(pool),
                fontSize: 14,
              ),
            ),
            TextSpan(
              text: value,
              style: TextStyle(
                fontWeight: FontWeight.w400,
                color: cs.primary.withAlpha(180),
                fontSize: 14,
              ),
            ),
          ],
        ),
      ),
      backgroundColor: cs.primary.withAlpha(25),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide.none,
      ),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
    );
  }
}

class TransactionTile extends StatelessWidget {
  final IconData icon;
  final MaterialColor color;
  final String label;
  final BigInt amount;
  final int date;
  final int id;
  final void Function()? onTap;
  final BigInt? zsaValue;
  final String? zsaLabel;
  final String? contactName;
  final int? confirmations;

  const TransactionTile({
    super.key,
    required this.icon,
    required this.color,
    required this.label,
    required this.amount,
    required this.date,
    required this.id,
    this.onTap,
    this.zsaValue,
    this.zsaLabel,
    this.contactName,
    this.confirmations,
  });

  /// Build the title: the transaction [label], optionally followed by a small,
  /// muted "( N conf )" confirmation suffix, and optionally the "→ contactName"
  /// recipient. Both decorations are independent and can appear together.
  Widget _buildTitle(BuildContext context) {
    final base = DefaultTextStyle.of(context).style;
    final smaller = base.fontSize == null ? null : base.fontSize! * 0.8;
    final Widget labelWidget = confirmations != null
        ? Text.rich(
            TextSpan(children: [
              TextSpan(text: label),
              TextSpan(
                text: " ( $confirmations conf )",
                style: TextStyle(fontSize: smaller, color: base.color?.withAlpha(160)),
              ),
            ]),
            overflow: TextOverflow.ellipsis,
          )
        : Text(label, overflow: TextOverflow.ellipsis);
    if (contactName != null) {
      return Row(
        children: [
          Flexible(child: labelWidget),
          Text(' → $contactName', style: TextStyle(color: color, fontWeight: FontWeight.w500)),
        ],
      );
    }
    return labelWidget;
  }

  @override
  Widget build(BuildContext context) {
    final d = timeToWidget(context, date);
    final hasZsa = zsaValue != null && zsaValue != BigInt.zero;
    return ListTile(
      onTap: onTap,
      leading: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: color.withAlpha(25),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Icon(icon, color: color),
      ),
      title: _buildTitle(context),
      subtitle: d,
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (hasZsa) ...[
            Text(
              "$zsaValue",
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.bold,
                fontSize: 16,
              ),
            ),
            if (zsaLabel != null)
              Text(
                zsaLabel!,
                style: TextStyle(
                  color: Colors.purple,
                  fontWeight: FontWeight.bold,
                  fontSize: 12,
                ),
              ),
          ] else
            Text(
              zatToShortString(amount),
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.bold,
                fontSize: 16,
              ),
            ),
        ],
      ),
    );
  }
}

class AccountCard extends StatelessWidget {
  final Widget leading;
  final String name;
  final Widget balance;
  final Widget height;
  final Widget? fiat;

  const AccountCard({
    super.key,
    required this.leading,
    required this.name,
    required this.balance,
    required this.height,
    required this.fiat,
  });

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          leading,
          const Gap(16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: tt.titleLarge,
                ),
                height,
              ],
            ),
          ),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            balance,
            if (fiat != null) fiat!,
          ])
        ],
      ),
    );
  }
}

enum PoolType {
  transparent("T"),
  sapling("S"),
  orchard("O");

  final String label;
  const PoolType(this.label);
}

Color poolTypeColor(PoolType pool) {
  switch (pool) {
    case PoolType.transparent:
      return Colors.red;
    case PoolType.sapling:
      return Colors.orange;
    case PoolType.orchard:
      return Colors.green;
  }
}

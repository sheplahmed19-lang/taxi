import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_session.dart';
import '../../shared/models/vehicle_type.dart';

/// Vehicle registration: picks a vehicle type and enters plate/model/color/year.
/// On success the driver profile becomes `pending` — an admin must approve it
/// (see admin/service.ts:approveDriver) before the driver can go online.
class DriverRegistrationScreen extends ConsumerStatefulWidget {
  const DriverRegistrationScreen({super.key, required this.onRegistered});

  final VoidCallback onRegistered;

  @override
  ConsumerState<DriverRegistrationScreen> createState() => _DriverRegistrationScreenState();
}

class _DriverRegistrationScreenState extends ConsumerState<DriverRegistrationScreen> {
  final _plateController = TextEditingController();
  final _modelController = TextEditingController();
  final _colorController = TextEditingController();

  List<VehicleType> _vehicleTypes = [];
  String? _selectedVehicleTypeId;
  bool _loadingTypes = true;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadVehicleTypes();
  }

  @override
  void dispose() {
    _plateController.dispose();
    _modelController.dispose();
    _colorController.dispose();
    super.dispose();
  }

  Future<void> _loadVehicleTypes() async {
    try {
      final types = await ref.read(driversRepositoryProvider).listVehicleTypes();
      setState(() {
        _vehicleTypes = types;
        _selectedVehicleTypeId = types.isNotEmpty ? types.first.id : null;
      });
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : 'Could not load vehicle types');
    } finally {
      if (mounted) setState(() => _loadingTypes = false);
    }
  }

  Future<void> _submit() async {
    final vehicleTypeId = _selectedVehicleTypeId;
    final plate = _plateController.text.trim();
    if (vehicleTypeId == null || plate.isEmpty) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ref.read(driversRepositoryProvider).register(
            vehicleTypeId: vehicleTypeId,
            plate: plate,
            model: _modelController.text.trim(),
            color: _colorController.text.trim(),
          );
      widget.onRegistered();
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : 'Registration failed');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Register your vehicle')),
      body: _loadingTypes
          ? const Center(child: CircularProgressIndicator())
          : Padding(
              padding: const EdgeInsets.all(16),
              child: ListView(
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: _selectedVehicleTypeId,
                    decoration: const InputDecoration(labelText: 'Vehicle type'),
                    items: _vehicleTypes
                        .map((vt) => DropdownMenuItem(value: vt.id, child: Text(vt.name)))
                        .toList(),
                    onChanged: (value) => setState(() => _selectedVehicleTypeId = value),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _plateController,
                    decoration: const InputDecoration(labelText: 'Plate number'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _modelController,
                    decoration: const InputDecoration(labelText: 'Model (optional)'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _colorController,
                    decoration: const InputDecoration(labelText: 'Color (optional)'),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  ],
                  const SizedBox(height: 24),
                  ElevatedButton(
                    onPressed: _submitting ? null : _submit,
                    child: _submitting
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Submit for approval'),
                  ),
                ],
              ),
            ),
    );
  }
}

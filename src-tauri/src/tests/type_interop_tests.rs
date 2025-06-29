#[cfg(test)]
mod tests {
    use crate::types::{ConnectRequestTS, RegistrationRequestTS, SessionSecuritySettingsTS};
    use citadel_internal_service_types::InternalServiceRequest;
    use serde_json::{from_str, to_string};
    use std::collections::HashMap;
    use std::convert::TryInto;
    use std::net::SocketAddr;

    #[test]
    fn test_registration_request_serialization() {
        // Create a RegistrationRequestTS instance
        let registration_request = RegistrationRequestTS {
            workspace_identifier: "127.0.0.1:54321".to_string(),
            profile_password: "default_profile_pass".to_string(),
            workspace_password: Some("test-password".to_string()),
            session_security_settings: SessionSecuritySettingsTS {
                security_level: "Paranoid".to_string(),
                secrecy_mode: "Absolute".to_string(),
                encryption_algorithm: "AesGcm256".to_string(),
                kem_algorithm: "Kyber1024".to_string(),
                sig_algorithm: "Dilithium5".to_string(),
                header_obfuscator_settings: HashMap::new(),
            },
            full_name: "Test User".to_string(),
            username: "testuser".to_string(),
        };

        // Serialize to JSON
        let json_str =
            to_string(&registration_request).expect("Failed to serialize RegistrationRequestTS");

        // Define the expected JSON structure (matching TypeScript format)
        let expected_json_str = serde_json::json!({
            "workspaceIdentifier": "127.0.0.1:54321",
            "profilePassword": "default_profile_pass",
            "workspacePassword": "test-password",
            "sessionSecuritySettings": {
                "securityLevel": "Paranoid",
                "secrecyMode": "Absolute",
                "encryptionAlgorithm": "AesGcm256",
                "kemAlgorithm": "Kyber1024",
                "sigAlgorithm": "Dilithium5",
                "headerObfuscatorSettings": {}
            },
            "fullName": "Test User",
            "username": "testuser"
        })
        .to_string();

        // Compare serialized JSON with expected JSON
        let actual_json: serde_json::Value =
            serde_json::from_str(&json_str).expect("Failed to parse JSON");
        let expected_json_value: serde_json::Value =
            serde_json::from_str(&expected_json_str).unwrap();

        assert_eq!(
            actual_json, expected_json_value,
            "JSON serialization mismatch for RegistrationRequestTS"
        );

        // Test deserialization from JSON
        let deserialized: RegistrationRequestTS =
            from_str(&json_str).expect("Failed to deserialize RegistrationRequestTS");
        assert_eq!(
            deserialized.workspace_identifier,
            registration_request.workspace_identifier
        );
        assert_eq!(
            deserialized.profile_password,
            registration_request.profile_password
        );
        assert_eq!(
            deserialized.workspace_password,
            registration_request.workspace_password
        );
        assert_eq!(
            deserialized.session_security_settings.security_level,
            registration_request
                .session_security_settings
                .security_level
        );
        assert_eq!(
            deserialized.session_security_settings.secrecy_mode,
            registration_request.session_security_settings.secrecy_mode
        );
        assert_eq!(
            deserialized.session_security_settings.encryption_algorithm,
            registration_request
                .session_security_settings
                .encryption_algorithm
        );
        assert_eq!(
            deserialized.session_security_settings.kem_algorithm,
            registration_request.session_security_settings.kem_algorithm
        );
        assert_eq!(
            deserialized.session_security_settings.sig_algorithm,
            registration_request.session_security_settings.sig_algorithm
        );
        assert_eq!(
            deserialized
                .session_security_settings
                .header_obfuscator_settings,
            registration_request
                .session_security_settings
                .header_obfuscator_settings
        );
        assert_eq!(deserialized.full_name, registration_request.full_name);
        assert_eq!(deserialized.username, registration_request.username);
    }

    #[test]
    fn test_connect_request_serialization() {
        // Create a ConnectRequestTS instance
        let ts_request = ConnectRequestTS {
            connect_mode: "Standard".to_string(),
            udp_mode: "Enabled".to_string(),
            username: "test-user".to_string(),
            password: vec![1, 2, 3, 4],
            keep_alive_timeout_ms: Some(5000),
            session_security_settings: SessionSecuritySettingsTS {
                security_level: "Recommended".to_string(),
                secrecy_mode: "PerfectForwardSecrecy".to_string(),
                encryption_algorithm: "ChaChaPoly1305".to_string(),
                kem_algorithm: "Kyber1024".to_string(),
                sig_algorithm: "Dilithium5".to_string(),
                header_obfuscator_settings: HashMap::new(),
            },
            server_password: Some("server_pass".to_string().into_bytes()),
        };

        let serialized = to_string(&ts_request).unwrap();

        // Deserialize and verify
        let deserialized: ConnectRequestTS = from_str(&serialized).unwrap();
        assert_eq!(deserialized.username, "test-user");
        assert_eq!(deserialized.password, vec![1, 2, 3, 4]);
        assert_eq!(deserialized.keep_alive_timeout_ms, Some(5000));
        assert_eq!(
            deserialized.session_security_settings.security_level,
            "Recommended"
        );
        assert_eq!(
            deserialized.session_security_settings.secrecy_mode,
            "PerfectForwardSecrecy"
        );
        assert_eq!(
            deserialized.session_security_settings.encryption_algorithm,
            "ChaChaPoly1305"
        );
        assert_eq!(
            deserialized.session_security_settings.kem_algorithm,
            "Kyber1024"
        );
        assert_eq!(
            deserialized.session_security_settings.sig_algorithm,
            "Dilithium5"
        );
        assert!(deserialized
            .session_security_settings
            .header_obfuscator_settings
            .is_empty());
        assert_eq!(
            deserialized.server_password,
            Some("server_pass".to_string().into_bytes())
        );
    }

    /* // TODO: Re-enable this test once ConnectResponseTS is defined and implemented
    #[test]
    fn test_connect_response_serialization() {
        // Create a ConnectResponseTS instance
        let connect_response = ConnectResponseTS {
            cid: Some("1234567890".to_string()),
            success: true,
            message: "Connection successful".to_string(),
        };

        // Serialize to JSON
        let json_str =
            to_string(&connect_response).expect("Failed to serialize ConnectResponseTS");

        // Define the expected JSON structure (matching TypeScript format)
        let expected_json_str = json!({
            "cid": "1234567890",
            "success": true,
            "message": "Connection successful"
        }).to_string();

        // Compare serialized JSON with expected JSON
        let actual_json: serde_json::Value =
            serde_json::from_str(&json_str).expect("Failed to parse JSON");
        let expected_json_value: serde_json::Value = serde_json::from_str(&expected_json_str).unwrap();

        assert_eq!(
            actual_json, expected_json_value,
            "JSON serialization mismatch for ConnectResponseTS"
        );

        // Test deserialization from JSON
        let deserialized: ConnectResponseTS =
            from_str(&json_str).expect("Failed to deserialize ConnectResponseTS");
        assert_eq!(connect_response.cid, deserialized.cid);
        assert_eq!(connect_response.success, deserialized.success);
        assert_eq!(connect_response.message, deserialized.message);
    }
    */

    #[test]
    fn test_registration_request_ts_try_into() {
        // Test conversion to InternalServiceRequest
        let registration_request_ts = RegistrationRequestTS {
            profile_password: "another_default_profile_pass".to_string(),
            workspace_identifier: "127.0.0.1:54321".to_string(),
            workspace_password: Some("test-workspace-password".to_string()),
            session_security_settings: SessionSecuritySettingsTS {
                security_level: "Extreme".to_string(),
                secrecy_mode: "Perfect".to_string(),
                encryption_algorithm: "AES_GCM_256".to_string(),
                kem_algorithm: "Kyber".to_string(),
                sig_algorithm: "Falcon1024".to_string(),
                header_obfuscator_settings: HashMap::new(),
            },
            full_name: "Test User".to_string(),
            username: "testuser".to_string(),
        };

        // Attempt the conversion
        let result: Result<InternalServiceRequest, String> =
            registration_request_ts.clone().try_into();
        assert!(result.is_ok());

        // Check if the conversion was successful and the variant is correct
        let internal_request = result.unwrap();
        assert!(matches!(
            internal_request,
            InternalServiceRequest::Register { .. }
        ));

        // Destructure and verify the fields
        if let InternalServiceRequest::Register {
            request_id: _,
            server_addr,
            full_name,
            username,
            proposed_password,
            connect_after_register,
            session_security_settings: _,
            server_password,
        } = internal_request
        {
            // Assertions on the fields directly
            assert_eq!(
                server_addr,
                registration_request_ts
                    .workspace_identifier
                    .parse::<SocketAddr>()
                    .unwrap()
            );
            assert_eq!(full_name, registration_request_ts.full_name);
            assert_eq!(username, registration_request_ts.username);
            assert_eq!(
                proposed_password.as_ref(),
                registration_request_ts.profile_password.as_bytes()
            );
            assert!(!connect_after_register); // As defaulted in TryFrom
                                              // Check if the Option<PreSharedKey> status matches the original Option<String> status
            assert_eq!(
                server_password.is_some(),
                registration_request_ts.workspace_password.is_some()
            );
        } else {
            // This branch should not be reached if the matches! assertion passed
            panic!(
                "Conversion did not result in InternalServiceRequest::Register variant as expected"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::commands::register::RegistrationRequestTS;
    use crate::util::RegistrationInfo;
    use serde_json::{json, to_string, from_str};

    // Define test versions of the types to avoid accessing private modules
    #[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
    struct TestConnectRequestTS {
        pub registrationInfo: RegistrationInfo,
    }

    #[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
    struct TestConnectResponseTS {
        pub cid: Option<String>,
        pub success: bool,
        pub message: String,
    }

    #[test]
    fn test_registration_request_serialization() {
        // Create a RegistrationRequestTS instance
        let registration_request = RegistrationRequestTS {
            workspaceIdentifier: "127.0.0.1:12345".to_string(),
            workspacePassword: "test-password".to_string(),
            securityLevel: 2,
            securityMode: 1,
            encryptionAlgorithm: 0,
            kemAlgorithm: 0,
            sigAlgorithm: 0,
            fullName: "Test User".to_string(),
            username: "testuser".to_string(),
            profilePassword: "test-profile-password".to_string(),
        };

        // Serialize to JSON
        let json_str = to_string(&registration_request).expect("Failed to serialize RegistrationRequestTS");
        
        // Define the expected JSON structure (matching TypeScript format)
        let expected_json = json!({
            "workspaceIdentifier": "127.0.0.1:12345",
            "workspacePassword": "test-password",
            "securityLevel": 2,
            "securityMode": 1,
            "encryptionAlgorithm": 0,
            "kemAlgorithm": 0,
            "sigAlgorithm": 0,
            "fullName": "Test User",
            "username": "testuser",
            "profilePassword": "test-profile-password"
        });
        
        // Compare serialized JSON with expected JSON
        let actual_json: serde_json::Value = serde_json::from_str(&json_str).expect("Failed to parse JSON");
        assert_eq!(actual_json, expected_json, "JSON serialization mismatch for RegistrationRequestTS");
        
        // Test deserialization from JSON
        let deserialized: RegistrationRequestTS = from_str(&json_str).expect("Failed to deserialize RegistrationRequestTS");
        assert_eq!(deserialized.workspaceIdentifier, registration_request.workspaceIdentifier);
        assert_eq!(deserialized.workspacePassword, registration_request.workspacePassword);
        assert_eq!(deserialized.securityLevel, registration_request.securityLevel);
        assert_eq!(deserialized.securityMode, registration_request.securityMode);
        assert_eq!(deserialized.encryptionAlgorithm, registration_request.encryptionAlgorithm);
        assert_eq!(deserialized.kemAlgorithm, registration_request.kemAlgorithm);
        assert_eq!(deserialized.sigAlgorithm, registration_request.sigAlgorithm);
        assert_eq!(deserialized.fullName, registration_request.fullName);
        assert_eq!(deserialized.username, registration_request.username);
        assert_eq!(deserialized.profilePassword, registration_request.profilePassword);
    }

    #[test]
    fn test_connect_request_serialization() {
        // Create a RegistrationInfo instance
        let registration_info = RegistrationInfo {
            server_address: "127.0.0.1:12345".to_string(),
            server_password: Some("test-password".to_string()),
            security_level: 2,
            security_mode: 1,
            encryption_algorithm: 0,
            kem_algorithm: 0,
            sig_algorithm: 0,
            full_name: "Test User".to_string(),
            username: "testuser".to_string(),
            profile_password: "test-profile-password".to_string(),
        };

        // Create a TestConnectRequestTS instance
        let connect_request = TestConnectRequestTS {
            registrationInfo: registration_info.clone(),
        };

        // Serialize to JSON
        let json_str = to_string(&connect_request).expect("Failed to serialize TestConnectRequestTS");
        
        // Define the expected JSON structure (matching TypeScript format)
        let expected_json = json!({
            "registrationInfo": {
                "server_address": "127.0.0.1:12345",
                "server_password": "test-password",
                "security_level": 2,
                "security_mode": 1,
                "encryption_algorithm": 0,
                "kem_algorithm": 0,
                "sig_algorithm": 0,
                "full_name": "Test User",
                "username": "testuser",
                "profile_password": "test-profile-password"
            }
        });
        
        // Compare serialized JSON with expected JSON
        let actual_json: serde_json::Value = serde_json::from_str(&json_str).expect("Failed to parse JSON");
        assert_eq!(actual_json, expected_json, "JSON serialization mismatch for TestConnectRequestTS");
        
        // Test deserialization from JSON
        let deserialized: TestConnectRequestTS = from_str(&json_str).expect("Failed to deserialize TestConnectRequestTS");
        assert_eq!(deserialized.registrationInfo.server_address, registration_info.server_address);
        assert_eq!(deserialized.registrationInfo.server_password, registration_info.server_password);
        assert_eq!(deserialized.registrationInfo.security_level, registration_info.security_level);
        assert_eq!(deserialized.registrationInfo.security_mode, registration_info.security_mode);
        assert_eq!(deserialized.registrationInfo.encryption_algorithm, registration_info.encryption_algorithm);
        assert_eq!(deserialized.registrationInfo.kem_algorithm, registration_info.kem_algorithm);
        assert_eq!(deserialized.registrationInfo.sig_algorithm, registration_info.sig_algorithm);
        assert_eq!(deserialized.registrationInfo.full_name, registration_info.full_name);
        assert_eq!(deserialized.registrationInfo.username, registration_info.username);
        assert_eq!(deserialized.registrationInfo.profile_password, registration_info.profile_password);
    }

    #[test]
    fn test_connect_response_serialization() {
        // Create a TestConnectResponseTS instance
        let connect_response = TestConnectResponseTS {
            cid: Some("12345".to_string()),
            success: true,
            message: "Connection successful".to_string(),
        };

        // Serialize to JSON
        let json_str = to_string(&connect_response).expect("Failed to serialize TestConnectResponseTS");
        
        // Define the expected JSON structure (matching TypeScript format)
        let expected_json = json!({
            "cid": "12345",
            "success": true,
            "message": "Connection successful"
        });
        
        // Compare serialized JSON with expected JSON
        let actual_json: serde_json::Value = serde_json::from_str(&json_str).expect("Failed to parse JSON");
        assert_eq!(actual_json, expected_json, "JSON serialization mismatch for TestConnectResponseTS");
        
        // Test deserialization from JSON
        let deserialized: TestConnectResponseTS = from_str(&json_str).expect("Failed to deserialize TestConnectResponseTS");
        assert_eq!(deserialized.cid, connect_response.cid);
        assert_eq!(deserialized.success, connect_response.success);
        assert_eq!(deserialized.message, connect_response.message);
    }

    #[test]
    fn test_registration_info_conversion() {
        // Create a RegistrationRequestTS instance
        let registration_request = RegistrationRequestTS {
            workspaceIdentifier: "127.0.0.1:12345".to_string(),
            workspacePassword: "test-password".to_string(),
            securityLevel: 2,
            securityMode: 1,
            encryptionAlgorithm: 0,
            kemAlgorithm: 0,
            sigAlgorithm: 0,
            fullName: "Test User".to_string(),
            username: "testuser".to_string(),
            profilePassword: "test-profile-password".to_string(),
        };

        // Convert to RegistrationInfo
        let registration_info: RegistrationInfo = registration_request.clone().into();
        
        // Verify conversion
        assert_eq!(registration_info.server_address, registration_request.workspaceIdentifier);
        assert_eq!(registration_info.server_password, Some(registration_request.workspacePassword));
        assert_eq!(registration_info.security_level, registration_request.securityLevel);
        assert_eq!(registration_info.security_mode, registration_request.securityMode);
        assert_eq!(registration_info.encryption_algorithm, registration_request.encryptionAlgorithm);
        assert_eq!(registration_info.kem_algorithm, registration_request.kemAlgorithm);
        assert_eq!(registration_info.sig_algorithm, registration_request.sigAlgorithm);
        assert_eq!(registration_info.full_name, registration_request.fullName);
        assert_eq!(registration_info.username, registration_request.username);
        assert_eq!(registration_info.profile_password, registration_request.profilePassword);
    }
}

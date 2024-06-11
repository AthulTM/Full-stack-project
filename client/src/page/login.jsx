import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { Grant } from "../assets";
import { LoginComponent } from "../components";
import { setLoading } from "../redux/loading";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSun, faMoon, faUser } from "@fortawesome/free-solid-svg-icons";
import "./style.scss";

const Login = () => {
  const location = useLocation();
  const [auth, setAuth] = useState(false);
  const { user } = useSelector((state) => state);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [darkTheme, setDarkTheme] = useState(false);

  useEffect(() => {
    if (!user) {
      if (location?.pathname === "/login/auth") {
        setAuth(true);
        setTimeout(() => {
          dispatch(setLoading(false));
        }, 1000);
      } else {
        setAuth(false);
        setTimeout(() => {
          dispatch(setLoading(false));
        }, 1000);
      }
    }
  }, [location]);

  const toggleTheme = () => {
    setDarkTheme((prevTheme) => !prevTheme);
    localStorage.setItem("theme", darkTheme);
  };

  return (
    <div className={`Auth ${darkTheme ? "dark" : "light"}`}>
      <div className="inner">
        <button className="theme-toggle" onClick={toggleTheme}>
          <FontAwesomeIcon icon={darkTheme ? faSun : faMoon} />
        </button>
        {auth ? (
          <LoginComponent darkTheme={darkTheme} />
        ) : (
          <div className="suggection">
            <div>
              <Grant />
            </div>
            <div>
              <p>Welcome to GE CoPilot™</p>
              <p>Log in or Sign up with your account to continue</p>
            </div>
            <div className="btns">
              <button
                onClick={() => {
                  navigate("/login/auth");
                }}>
                <span>Log in</span>
                <i className="fas fa-sign-in-alt"></i>
              </button>
              <button
                onClick={() => {
                  navigate("/signup");
                }}>
                <span>Sign up</span>
                <i className="fa fa-user-plus"></i>
              </button>
            </div>
          </div>
        )}
        <div className="bottum"></div>
      </div>
    </div>
  );
};

export default Login;
